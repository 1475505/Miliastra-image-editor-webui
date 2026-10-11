import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function moduleUrl(path) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
}
const { sliceRegions, resolveImageType, supportsImageStretch, normalizeImageElement } = await import(moduleUrl("../src/imageStretch.ts"));
const library = await import(moduleUrl("../src/imageLibrary.ts"));
const meta = { id: 106030, width: 90, height: 90, stretchable: true,
  border: { left: 45, right: 45, top: 45, bottom: 45 } };

test("nonzero borders default to Stretch while zero/missing borders only permit Basic", () => {
  assert.equal(supportsImageStretch(meta), true);
  assert.equal(resolveImageType(meta), "stretch");
  assert.equal(resolveImageType(meta, "basic"), "basic");
  for (const id of [100001, 105222]) {
    const flat = { ...meta, id, border: { left: 0, right: 0, top: 0, bottom: 0 } };
    assert.equal(supportsImageStretch(flat), false);
    assert.equal(resolveImageType(flat), "basic");
    assert.equal(resolveImageType(flat, "stretch"), "basic");
  }
  assert.equal(resolveImageType({ ...meta, border: { left: 4, right: 0, top: 0, bottom: 0 } }), "stretch");
  assert.equal(resolveImageType(null, "stretch"), "basic");
});

test("pending metadata keeps defaults unresolved and preserves explicit Basic after loading", () => {
  const image = { type: "image", imageAssetId: 106030 };
  assert.equal(normalizeImageElement(image, undefined), image);
  assert.equal(normalizeImageElement(image, meta).imageType, "stretch");
  const basic = { ...image, imageType: "basic" };
  assert.equal(normalizeImageElement(basic, meta), basic);
  assert.equal(normalizeImageElement({ ...image, imageType: "stretch" }, null).imageType, "basic");
  const shape = { type: "rectangle" };
  assert.equal(normalizeImageElement(shape, meta), shape);
});

test("106030 uses raw 45-unit corners and retains its zero-span center", () => {
  const regions = sliceRegions(meta, 407.5, 265);
  assert.equal(regions.length, 9);
  assert.deepEqual(regions[0], { source: [0, 0, 45, 45], target: [0, 0, 45, 45] });
  assert.deepEqual(regions[4], { source: [45, 45, 0, 0], target: [45, 45, 317.5, 175] });
  assert.deepEqual(regions[8], { source: [45, 45, 45, 45], target: [362.5, 220, 45, 45] });
});

test("small controls shrink opposing borders proportionally with no overlap", () => {
  const regions = sliceRegions(meta, 40, 30);
  assert.equal(regions.length, 4);
  assert.deepEqual(regions.map((item) => item.target), [[0, 0, 20, 15], [20, 0, 20, 15], [0, 15, 20, 15], [20, 15, 20, 15]]);
});

test("horizontal three-slice and zero-border sprites cover the whole target", () => {
  const horizontal = sliceRegions({ ...meta, border: { ...meta.border, top: 0, bottom: 0 } }, 300, 120);
  assert.equal(horizontal.length, 3);
  assert.deepEqual(horizontal[1], { source: [45, 0, 0, 90], target: [45, 0, 210, 120] });
  const plain = sliceRegions({ ...meta, border: { left: 0, right: 0, top: 0, bottom: 0 } }, 300, 120);
  assert.deepEqual(plain, [{ source: [0, 0, 90, 90], target: [0, 0, 300, 120] }]);
});

test("oversized source borders normalize before fitting the target", () => {
  const regions = sliceRegions({ ...meta, width: 60, border: { left: 60, right: 30, top: 0, bottom: 0 } }, 30, 90);
  assert.deepEqual(regions, [
    { source: [0, 0, 40, 90], target: [0, 0, 20, 90] },
    { source: [40, 0, 20, 90], target: [20, 0, 10, 90] }
  ]);
  assert.deepEqual(sliceRegions(meta, 0, 10), []);
});

test("repeated sprites share metadata requests and failed requests can retry", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const storage = new Map();
  globalThis.window = { localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  } };
  try {
    library.clearLibraryCache();
    let calls = 0;
    let finish;
    const pending = new Promise((resolve) => { finish = resolve; });
    globalThis.fetch = async () => { calls++; return pending; };
    const first = library.loadSpriteMeta(106030);
    const second = library.loadSpriteMeta(106030);
    assert.equal(calls, 1);
    finish(new Response(JSON.stringify(meta)));
    assert.deepEqual(await first, meta);
    assert.deepEqual(await second, meta);
    assert.deepEqual(await library.loadSpriteMeta(106030), meta);
    assert.equal(calls, 1);
    globalThis.fetch = async () => { calls++; return new Response("", { status: 502 }); };
    await assert.rejects(library.loadSpriteMeta(106031), /502/);
    globalThis.fetch = async () => { calls++; return new Response("", { status: 404 }); };
    assert.equal(await library.loadSpriteMeta(106031), null);
    assert.equal(await library.loadSpriteMeta(106031), null);
    assert.equal(calls, 3);
  } finally {
    library.clearLibraryCache();
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});
