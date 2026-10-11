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
const { defaultLibraryImageSize, sliceRegions, rasterSliceRegions, resolveImageType, supportsImageStretch, normalizeImageElement } = await import(moduleUrl("../src/imageStretch.ts"));
const library = await import(moduleUrl("../src/imageLibrary.ts"));
const meta = { id: 106030, width: 90, height: 90, stretchable: true,
  border: { left: 45, right: 45, top: 45, bottom: 45 } };

test("new stretch sprites use preview dimensions while basic and unsliced axes retain native size", () => {
  const small = { ...meta, id: 106020, width: 60, height: 60,
    border: { left: 30, right: 30, top: 30, bottom: 30 } };
  assert.deepEqual(defaultLibraryImageSize(small), { width: 136, height: 96 });
  assert.deepEqual(defaultLibraryImageSize({ ...small, border: { left: 0, right: 0, top: 0, bottom: 0 } }),
    { width: 60, height: 60 });
  assert.deepEqual(defaultLibraryImageSize({ ...meta, width: 144, height: 100,
    border: { left: 72, right: 72, top: 0, bottom: 0 } }), { width: 136, height: 100 });
  assert.deepEqual(defaultLibraryImageSize({ ...meta, width: 8, height: 17,
    border: { left: 0, right: 0, top: 4, bottom: 4 } }), { width: 8, height: 96 });
  assert.deepEqual(defaultLibraryImageSize(undefined), { width: 96, height: 96 });
  assert.deepEqual(defaultLibraryImageSize(null), { width: 96, height: 96 });
});

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

test("raster slices cover each pixel once at fractional borders and keep zero-span samples inside the source", () => {
  const fractional = { ...meta, border: { left: 44.4, right: 45.6, top: 44.7, bottom: 45.3 } };
  const edge = { ...meta, border: { left: 90, right: 0, top: 90, bottom: 0 } };
  for (const [metadata, width, height] of [[meta, 136, 96], [fractional, 407, 265],
                                          [fractional, 40, 31], [edge, 136, 96]]) {
    const coverage = new Uint8Array(width * height);
    for (const { source: [sx, sy, sw, sh], target: [x, y, w, h] } of rasterSliceRegions(metadata, width, height, 180, 180)) {
      assert.ok(sw > 0 && sh > 0 && sx >= 0 && sy >= 0 && sx + sw <= 180 && sy + sh <= 180);
      for (let row = y; row < y + h; row++) for (let column = x; column < x + w; column++) coverage[row * width + column]++;
    }
    assert.ok(coverage.every(count => count === 1), "no pixel may be empty or composited twice");
  }
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
    const requests = [];
    globalThis.fetch = async (url, options) => {
      requests.push([url, options]);
      return new Response(JSON.stringify(meta));
    };
    assert.deepEqual(await library.loadSpriteMeta(106031, { refresh: true }), meta);
    assert.equal(requests[0][0], "/api/library/meta/106031?refresh=1");
    assert.equal(requests[0][1].cache, "no-store");
    assert.deepEqual(await library.loadSpriteMeta(106031), meta);
    assert.equal(requests.length, 1);
  } finally {
    library.clearLibraryCache();
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});
