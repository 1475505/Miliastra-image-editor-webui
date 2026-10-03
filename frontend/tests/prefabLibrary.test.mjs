import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/prefabLibrary.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } });
const library = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const storage = new Map();
globalThis.window = { localStorage: {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key)
} };
// Synthetic miniature catalog; no production data is bundled in the app.
const payload = {
  schemaVersion: 1,
  prefabs: {
    20001003: { id: 20001003, names: { "zh-CN": "测试竹子" }, entityType: "Gadget", gadgetId: 80900003,
                img: "sprite/20001003.png", imageUrl: "https://oss.example/prefabs/sprite/20001003.png", width: 256, height: 256, categoryIds: [120201] },
    30005016: { id: 30005016, names: {}, entityType: "Monster", gadgetId: null, imageUrl: null, categoryIds: [] }
  },
  categories: { 120201: { id: 120201, names: { "zh-CN": "测试树木" }, prefabIds: [20001003] } },
  source: { build: "test" }
};

test("exact ID lookup loads once, preserves categories and never aliases sprite/list/gadget IDs", async () => {
  library.clearPrefabCache();
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response(JSON.stringify(payload), { headers: { ETag: '"p1.test.zh.en"' } }); };
  const info = await library.getPrefabInfo("２０００１００３.png");
  assert.equal(info.id, 20001003);
  assert.equal(info.categories[0].names["zh-CN"], "测试树木");
  assert.equal(info.width, 256);
  info.names["zh-CN"] = "mutated";
  assert.equal((await library.getPrefabInfo(20001003)).names["zh-CN"], "测试竹子");
  assert.equal((await library.getPrefabInfo(30005016)).imageUrl, null);
  for (const value of [1000003, 80900003, 106001]) {
    await assert.rejects(library.getPrefabInfo(value), (e) => e.kind === "not-found");
  }
  assert.equal(requests, 1);
});

test("invalid IDs make no network request", async () => {
  library.clearPrefabCache();
  globalThis.fetch = () => { throw new Error("must not fetch"); };
  for (const id of [0, -1, 4294967296, "20.5", "../20001003", "", "020001003"]) {
    await assert.rejects(library.getPrefabInfo(id), (e) => e.kind === "invalid-id");
  }
});

test("cached catalog revalidates via 304, refresh bypasses it, and outage marks cached results stale", async () => {
  library.clearPrefabCache();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push([url, options]);
    if (calls.length === 2) return new Response(null, { status: 304 });
    return new Response(JSON.stringify(payload), { headers: { ETag: '"p1.test.zh.en"' } });
  };
  await library.getPrefabInfo(20001003);
  const [key, raw] = [...storage.entries()][0];
  const expired = JSON.parse(raw);
  expired.fetchedAt = 1;
  library.clearPrefabCache();
  storage.set(key, JSON.stringify(expired));
  assert.equal((await library.getPrefabInfo(20001003)).stale, false);
  assert.equal(calls[1][1].headers["If-None-Match"], '"p1.test.zh.en"');
  await library.getPrefabInfo(20001003, { refresh: true });
  assert.equal(calls[2][0], "/api/prefabs/catalog?refresh=1");
  assert.deepEqual(calls[2][1].headers, {});
  globalThis.fetch = async () => { throw new Error("offline"); };
  assert.equal((await library.getPrefabInfo(20001003, { refresh: true })).stale, true);
});

test("first visit outage or malformed response is explicit", async () => {
  library.clearPrefabCache();
  globalThis.fetch = async () => new Response("upstream missing", { status: 502 });
  await assert.rejects(library.getPrefabInfo(20001003), (e) => e.kind === "unavailable");
  globalThis.fetch = async () => new Response(JSON.stringify({ imageData: {} }));
  await assert.rejects(library.getPrefabInfo(20001003), (e) => e.kind === "unavailable");
});

test("public v2 works without private IDs and disallows unlisted or mismatched image paths", async () => {
  library.clearPrefabCache();
  const publicPayload = structuredClone(payload);
  publicPayload.schemaVersion = 2;
  delete publicPayload.source;
  delete publicPayload.prefabs[20001003].gadgetId;
  globalThis.fetch = async () => new Response(JSON.stringify(publicPayload));
  assert.equal((await library.getPrefabInfo(20001003)).gadgetId, undefined);
  assert.equal(library.defaultPrefabVariable(20001003), "prefab_20001003");
  assert.equal(library.validPrefabVariable("竹子元件"), true);
  assert.equal(library.validPrefabVariable("\n"), false);
  for (const patch of [{ img: null }, { img: "sprite/30005016.png" }, { imageUrl: "https://oss.example/prefabs/sprite/99999999.png" }]) {
    library.clearPrefabCache();
    const invalid = structuredClone(publicPayload);
    Object.assign(invalid.prefabs[20001003], patch);
    globalThis.fetch = async () => new Response(JSON.stringify(invalid));
    await assert.rejects(library.getPrefabInfo(20001003), (e) => e.kind === "unavailable");
  }
});
