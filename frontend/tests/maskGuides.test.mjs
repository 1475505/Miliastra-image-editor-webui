import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const js = ts.transpileModule(readFileSync(new URL('../src/maskGuides.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
}).outputText;
const { alphaContourPath, outlineAlpha } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

function polygons(path) {
  return path.split('Z').filter(Boolean).map(p => [...p.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map(m => [Number(m[1]), Number(m[2])]));
}
function area(points) {
  return points.reduce((sum, [x, y], i) => {
    const next = points[(i + 1) % points.length];
    return sum + x * next[1] - y * next[0];
  }, 0) / 2;
}

function contains(outlines, x, y) {
  let inside = false;
  for (const loop of outlines) for (let i=0,j=loop.length-1;i<loop.length;j=i++) {
    const [ax,ay]=loop[i], [bx,by]=loop[j];
    if ((ay>y)!==(by>y) && x < (bx-ax)*(y-ay)/(by-ay)+ax) inside=!inside;
  }
  return inside;
}

test('editing outlines preserve outside borders, transparent holes and disconnected islands', () => {
  const ring = new Uint8ClampedArray([255,255,255,255,0,255,255,255,255]);
  const outlines = polygons(alphaContourPath(ring, 3, 3));
  assert.equal(outlines.length, 2);
  assert.equal(contains(outlines, 1.5, 1.5), false);
  assert.equal(contains(outlines, .5, 1.5), true);
  assert.equal(alphaContourPath(new Uint8ClampedArray(9), 3, 3), '');
  const split = polygons(alphaContourPath(new Uint8ClampedArray([255,0,255]), 3, 1));
  assert.equal(split.length, 2);
  assert.equal(contains(split,.5,.5),true);
  assert.equal(contains(split,1.5,.5),false);
  assert.equal(contains(split,2.5,.5),true);
});

test('outline threshold and diagonal contacts stay closed with bounded coordinates', () => {
  const alpha = new Uint8ClampedArray([255,0,127,0,255,128,0,0,255]);
  const outlines = polygons(alphaContourPath(alpha, 3, 3));
  const normalized = outlineAlpha(alpha,3,3);
  for (let y=0;y<3;y++) for(let x=0;x<3;x++) assert.equal(contains(outlines,x+.5,y+.5),normalized[y*3+x]>=128);
  assert.ok(outlines.every(p => p.every(([x,y]) => x >= -.5 && x <= 3.5 && y >= -.5 && y <= 3.5)));
  assert.deepEqual(alpha, new Uint8ClampedArray([255,0,127,0,255,128,0,0,255]));
});

test('half-transparent diamond remains whole beside a fully opaque island', () => {
  const width=15,height=17,alpha=new Uint8ClampedArray(width*height);
  // A low-alpha antialias fringe around a half-opaque diamond, with 127/129 noise.
  for(let y=0;y<9;y++)for(let x=0;x<width;x++){
    const d=Math.abs(x-7)+Math.abs(y-4);
    alpha[y*width+x]=d<=3 ? (x>7?127:129) : d===4?27:0;
  }
  // A faint compression fringe must not join it to the opaque lower mark.
  for(let x=0;x<width;x++)alpha[9*width+x]=1;
  for(let y=11;y<16;y++)for(let x=3;x<12;x++)alpha[y*width+x]=255;
  const original=alpha.slice(),outlines=polygons(alphaContourPath(alpha,width,height));
  assert.equal(outlines.length,2);
  for(let y=0;y<9;y++)for(let x=0;x<width;x++) {
    if(Math.abs(x-7)+Math.abs(y-4)<=3)assert.equal(contains(outlines,x+.5,y+.5),true,`diamond ${x},${y}`);
  }
  assert.equal(contains(outlines,7.5,9.5),false);
  assert.equal(contains(outlines,7.5,13.5),true);
  assert.deepEqual(alpha,original,'the guide must never change actual mask transparency');
});

test('antialiased circle contour follows fractional alpha instead of pixel stairs', () => {
  const size=64,radius=23.25,alpha=new Uint8ClampedArray(size*size);
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const distance=Math.hypot(x+.5-size/2,y+.5-size/2);
    alpha[y*size+x]=Math.round(255*Math.max(0,Math.min(1,.5+radius-distance)));
  }
  const [loop]=polygons(alphaContourPath(alpha,size,size));
  assert.ok(loop.length>30);
  assert.ok(loop.some(([x,y])=>x%1!==0&&y%1!==0));
  for(const [x,y] of loop) assert.ok(Math.abs(Math.hypot(x-size/2,y-size/2)-radius)<.3);
  assert.ok(Math.abs(Math.abs(area(loop))-Math.PI*radius**2)/(Math.PI*radius**2)<.01);
  assert.equal(contains([loop],32,32),true);
  assert.equal(contains([loop],2,2),false);
});
