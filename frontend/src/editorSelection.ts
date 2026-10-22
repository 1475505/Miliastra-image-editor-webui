import type { SceneElement } from "./App";
import { rotationMatrix } from "./rotation";

export type SelectionRect = { x: number; y: number; width: number; height: number };
export function selectionRect(a: { x: number; y: number }, b: { x: number; y: number }): SelectionRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

function corners(element: SceneElement) {
  const { a, b, c, d } = rotationMatrix(element);
  const w = element.width * (element.type === "textbox" ? Math.abs(element.textBox?.scaleX ?? 1) : 1) / 2;
  const h = element.height * (element.type === "textbox" ? Math.abs(element.textBox?.scaleY ?? 1) : 1) / 2;
  return [[-w,-h],[w,-h],[w,h],[-w,h]].map(([x,y]) => ({ x: element.x + a*x + c*y, y: element.y + b*x + d*y }));
}

export function selectionBounds(elements: SceneElement[]): SelectionRect | null {
  if (!elements.length) return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const element of elements) for (const p of corners(element)) {
    left = Math.min(left,p.x); right = Math.max(right,p.x); top = Math.min(top,p.y); bottom = Math.max(bottom,p.y);
  }
  return { x: left, y: top, width: right-left, height: bottom-top };
}

/** SAT intersection uses projected control boxes (not mask alpha) so clipped content stays selectable. */
export function intersectsSelection(element: SceneElement, rect: SelectionRect): boolean {
  const points = corners(element);
  const box = [{x:rect.x,y:rect.y},{x:rect.x+rect.width,y:rect.y},{x:rect.x+rect.width,y:rect.y+rect.height},{x:rect.x,y:rect.y+rect.height}];
  const axes = [{x:1,y:0},{x:0,y:1}];
  for (let i=0;i<2;i++) axes.push({ x: points[i+1].y-points[i].y, y: points[i].x-points[i+1].x });
  return axes.every(axis => {
    const project = (p: {x:number;y:number}) => p.x*axis.x+p.y*axis.y;
    const a = points.map(project), b = box.map(project);
    return Math.max(...a) >= Math.min(...b)-1e-8 && Math.max(...b) >= Math.min(...a)-1e-8;
  });
}

export function clickSelection(current: string[], id: string, toggle: boolean, range: boolean, order: string[], anchor: string | null): string[] {
  if (range && anchor && order.includes(anchor) && order.includes(id)) {
    const a = order.indexOf(anchor), b = order.indexOf(id), ids = order.slice(Math.min(a,b),Math.max(a,b)+1);
    return toggle ? [...new Set([...current,...ids])] : ids;
  }
  if (toggle) return current.includes(id) ? current.filter(value => value !== id) : [...current,id];
  return [id];
}

/** Clamp one common delta, rather than clamping each item and distorting the arrangement. */
export function translateSelection(elements: SceneElement[], ids: readonly string[], dx: number, dy: number, canvas?: {width:number;height:number}): SceneElement[] {
  const chosen = new Set(ids), targets = elements.filter(e=>chosen.has(e.id));
  if (!targets.length) return elements;
  if (canvas) {
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for (const e of targets) { minX=Math.min(minX,e.x);maxX=Math.max(maxX,e.x);minY=Math.min(minY,e.y);maxY=Math.max(maxY,e.y); }
    // Imported overflow may move back toward the canvas, without jumping on first input.
    dx = Math.max(Math.min(0,-minX), Math.min(Math.max(0,canvas.width-maxX),dx));
    dy = Math.max(Math.min(0,-minY), Math.min(Math.max(0,canvas.height-maxY),dy));
  }
  if (dx === 0 && dy === 0) return elements;
  return elements.map(e=>chosen.has(e.id)?{...e,x:e.x+dx,y:e.y+dy}:e);
}

export function reorderSelection(elements: SceneElement[], ids: readonly string[], direction: "up"|"down"|"top"|"bottom"): SceneElement[] {
  const chosen = new Set(ids), ordered = [...elements].sort((a,b)=>a.zIndex-b.zIndex);
  let list = ordered;
  if (direction === "top" || direction === "bottom") {
    const selected=ordered.filter(e=>chosen.has(e.id)),rest=ordered.filter(e=>!chosen.has(e.id));
    list=direction==="top"?[...rest,...selected]:[...selected,...rest];
  } else if (direction === "up") {
    for (let i=list.length-2;i>=0;i--) if(chosen.has(list[i].id)&&!chosen.has(list[i+1].id)) [list[i],list[i+1]]=[list[i+1],list[i]];
  } else {
    for (let i=1;i<list.length;i++) if(chosen.has(list[i].id)&&!chosen.has(list[i-1].id)) [list[i],list[i-1]]=[list[i-1],list[i]];
  }
  return list.map((e,i)=>e.zIndex===i?e:{...e,zIndex:i});
}

export function cloneSelection(elements: SceneElement[], makeId: () => string, startZ: number, offset = 10): SceneElement[] {
  return [...elements].sort((a,b)=>a.zIndex-b.zIndex).map((e,i)=>({ ...structuredClone(e), id:makeId(), x:e.x+offset,y:e.y+offset,zIndex:startZ+i }));
}

export function editableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest("input,textarea,select,[contenteditable]:not([contenteditable='false'])")));
}
