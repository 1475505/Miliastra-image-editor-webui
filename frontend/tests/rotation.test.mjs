import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const { outputText } = ts.transpileModule(readFileSync(new URL("../src/rotation.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
});
const { rotationMatrix, rotationCss, unprojectVector } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
test("device single-axis compression, edge-on and back-face signs; inverse resizing", () => {
  for (const axis of ["rotationX", "rotationY"]) for (const [angle, ratio] of [[0, 1], [30, Math.sqrt(3)/2], [60, .5], [90, 0], [120, -.5], [180, -1]]) {
    const r = { rotation: 0, [axis]: angle }, m = rotationMatrix(r);
    close(m.a, axis === "rotationY" ? ratio : 1);
    close(m.d, axis === "rotationX" ? ratio : 1);
    if (!ratio) assert.equal(unprojectVector(5, 10, r), null);
    else {
      const p = unprojectVector(m.a * 50, m.d * 30, r);
      close(p.x, 50); close(p.y, 30);
    }
  }
  assert.equal(rotationCss({ rotation: 0, rotationY: 180 }), "matrix(-1,0,0,1,0,0)");
});
test("equivalent ROTXY2 Euler readbacks and combined-axis inverse", () => {
  for (const [a, b] of [
    [{ rotation: 0, rotationX: 120 }, { rotation: 180, rotationX: 60, rotationY: 180 }],
    [{ rotation: 0, rotationX: 180 }, { rotation: 180, rotationY: 180 }],
  ]) for (const key of ["a", "b", "c", "d"]) close(rotationMatrix(a)[key], rotationMatrix(b)[key]);
  const r = { rotation: 35, rotationX: 40, rotationY: 20 }, m = rotationMatrix(r);
  const p = unprojectVector(m.a * 25 + m.c * 18, m.b * 25 + m.d * 18, r);
  close(p.x, 25); close(p.y, 18);
});
