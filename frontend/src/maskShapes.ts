export const MASK_SHAPES = [
  { id: 100001, name: "rectangle" }, { id: 100002, name: "ellipse" },
  { id: 100003, name: "triangle" }, { id: 100004, name: "four_point_star" },
  { id: 100005, name: "five_point_star" }, { id: 100006, name: "ring" }
] as const;

export const MASK_POLYGONS: Record<number, number[][]> = {
  100003: [[.5, 0], [0, 1], [1, 1]],
  100004: [[.5, 0], [.62, .38], [1, .5], [.62, .62], [.5, 1], [.38, .62], [0, .5], [.38, .38]],
  100005: [[.5, 0], [.61, .35], [.98, .35], [.68, .57], [.79, .92], [.5, .71], [.21, .92], [.32, .57], [.02, .35], [.39, .35]]
};

export function isBasicMask(id: number): boolean {
  return MASK_SHAPES.some(shape => shape.id === id);
}

/** Same geometric proxies as the editor's basic shapes; not native shader math. */
export function drawBasicMask(ctx: CanvasRenderingContext2D, id: number, width: number, height: number) {
  ctx.fillStyle = "white";
  if (id === 100001) { ctx.fillRect(0, 0, width, height); return; }
  ctx.beginPath();
  if (id === 100002 || id === 100006) {
    ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    if (id === 100006) {
      ctx.moveTo(width * .9, height / 2);
      ctx.ellipse(width / 2, height / 2, width * .4, height * .4, 0, 0, Math.PI * 2);
    }
  } else {
    for (const [index, point] of (MASK_POLYGONS[id] ?? []).entries()) {
      if (index === 0) ctx.moveTo(point[0] * width, point[1] * height);
      else ctx.lineTo(point[0] * width, point[1] * height);
    }
    ctx.closePath();
  }
  ctx.fill("evenodd");
}
