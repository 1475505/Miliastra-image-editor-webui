import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const js = ts.transpileModule(readFileSync(new URL('../src/maskGuides.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
}).outputText;
const { alphaContourPath } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

function polygons(path) {
  return path.split('Z').filter(Boolean).map(p => [...p.matchAll(/[ML](\d+),(\d+)/g)].map(m => [Number(m[1]), Number(m[2])]));
}
function area(points) {
  return points.reduce((sum, [x, y], i) => {
    const next = points[(i + 1) % points.length];
    return sum + x * next[1] - y * next[0];
  }, 0) / 2;
}

test('editing outlines preserve outside borders, transparent holes and disconnected islands', () => {
  const ring = new Uint8ClampedArray([255,255,255,255,0,255,255,255,255]);
  const outlines = polygons(alphaContourPath(ring, 3, 3));
  assert.deepEqual(outlines.map(area).sort((a,b) => a-b), [-1, 9]);
  assert.equal(outlines.reduce((sum,p) => sum + area(p), 0), 8);
  assert.equal(alphaContourPath(new Uint8ClampedArray(9), 3, 3), '');
  const split = polygons(alphaContourPath(new Uint8ClampedArray([255,0,255]), 3, 1));
  assert.deepEqual(split.map(area), [1, 1]);
});

test('outline threshold and diagonal contacts stay closed with bounded coordinates', () => {
  const alpha = new Uint8ClampedArray([255,0,127,0,255,128,0,0,255]);
  const outlines = polygons(alphaContourPath(alpha, 3, 3));
  assert.equal(outlines.reduce((sum,p) => sum + area(p), 0), 4);
  assert.ok(outlines.every(p => p.every(([x,y]) => x >= 0 && x <= 3 && y >= 0 && y <= 3)));
  assert.deepEqual(alpha, new Uint8ClampedArray([255,0,127,0,255,128,0,0,255]));
});
