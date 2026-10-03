import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
}).outputText;
const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const libraryUrl = url(compile("../src/prefabLibrary.ts"));
const library = await import(libraryUrl);
const source = compile("../src/prefabHistory.ts").replace(JSON.stringify("./prefabLibrary"), JSON.stringify(libraryUrl));
let instance = 0;
const freshHistory = () => import(url(source + `\n// instance ${++instance}`));
const key = "miliastra:prefab-history:v1";
const catalog = { schemaVersion: 2, categories: {}, prefabs: {
  20001003: { id: 20001003, img: "sprite/20001003.png", imageUrl: "https://oss.example/prefabs/sprite/20001003.png", width: 256, height: 256, categoryIds: [] },
  30005016: { id: 30005016, img: "sprite/30005016.png", imageUrl: "https://oss.example/prefabs/sprite/30005016.png", width: 256, height: 256, categoryIds: [] },
  20001303: { id: 20001303, img: null, imageUrl: null, width: null, height: null, categoryIds: [] }
} };

function setup() {
  const storage = new Map();
  const events = new Map();
  const requests = [];
  globalThis.window = { localStorage: {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k)
  }, addEventListener: (type, handler) => events.set(type, handler),
     removeEventListener: (type, handler) => { if (events.get(type) === handler) events.delete(type); } };
  library.clearPrefabCache();
  globalThis.fetch = async (request) => { requests.push(request); return new Response(JSON.stringify(catalog)); };
  return { storage, events, requests };
}

test("successful additions are deduplicated, most recently added first, and persist across reload", async () => {
  const { storage, requests } = setup();
  const history = await freshHistory();
  let changes = 0;
  const unsubscribe = history.subscribePrefabHistory(() => changes++);
  assert.deepEqual(history.getPrefabHistory(), []);
  await history.recordAddedPrefabs([20001003, 20001003, 99999999, 20001303, 0]);
  await history.recordAddedPrefabs([30005016]);
  await history.recordAddedPrefabs([20001003]);
  assert.deepEqual(history.getPrefabHistory().map((entry) => entry.id), [20001003, 30005016]);
  assert.equal(changes, 3);
  assert.deepEqual(requests, ["/api/prefabs/catalog"]);
  assert.deepEqual(Object.keys(JSON.parse(storage.get(key))[0]).sort(), ["addedAt", "id"]);
  const copy = history.getPrefabHistory();
  copy[0].id = 123;
  assert.equal(history.getPrefabHistory()[0].id, 20001003);
  const reloaded = await freshHistory();
  assert.deepEqual(reloaded.getPrefabHistory(), history.getPrefabHistory());
  history.removePrefabHistory(20001003);
  assert.deepEqual(history.getPrefabHistory().map((entry) => entry.id), [30005016]);
  history.clearPrefabHistory();
  assert.deepEqual(history.getPrefabHistory(), []);
  unsubscribe();
});

test("malformed storage is safe, duplicate rows keep their latest timestamp, and storage events refresh the list", async () => {
  const { storage, events } = setup();
  storage.set(key, "invalid JSON");
  const history = await freshHistory();
  assert.deepEqual(history.getPrefabHistory(), []);
  let changes = 0;
  const unsubscribe = history.subscribePrefabHistory(() => changes++);
  storage.set(key, JSON.stringify([
    { id: 20001003, addedAt: 1 }, { id: 20001003, addedAt: 3 }, { id: 30005016, addedAt: 2 },
    { id: "20001003", addedAt: 100 }, { id: 0, addedAt: 100 }, { id: 4294967296, addedAt: 100 },
    { id: 20001303, addedAt: -1 }, { id: 20001303, addedAt: "100" }, null
  ]));
  events.get("storage")({ key: "unrelated" });
  assert.equal(changes, 0);
  events.get("storage")({ key });
  assert.equal(changes, 1);
  assert.deepEqual(history.getPrefabHistory(), [{ id: 20001003, addedAt: 3 }, { id: 30005016, addedAt: 2 }]);
  storage.delete(key);
  events.get("storage")({ key: null });
  assert.deepEqual(history.getPrefabHistory(), []);
  unsubscribe();
  assert.equal(events.has("storage"), false);
});

test("storage denial retains session history and a catalog outage does not erase existing history", async () => {
  const { storage } = setup();
  const history = await freshHistory();
  await history.recordAddedPrefabs([20001003]);
  storage.delete("miliastra:prefab-library:v2");
  library.clearPrefabCache();
  globalThis.fetch = async () => { throw new Error("offline"); };
  await history.recordAddedPrefabs([30005016]);
  assert.deepEqual(history.getPrefabHistory().map((entry) => entry.id), [20001003]);
  globalThis.fetch = async () => new Response(JSON.stringify(catalog));
  window.localStorage.setItem = () => { throw new Error("storage denied"); };
  await history.recordAddedPrefabs([30005016]);
  assert.deepEqual(history.getPrefabHistory().map((entry) => entry.id), [30005016, 20001003]);
});

test("clearing or removing history wins over an earlier addition waiting on the catalog", async () => {
  setup();
  const history = await freshHistory();
  let release;
  globalThis.fetch = () => new Promise((resolve) => { release = resolve; });
  const pending = history.recordAddedPrefabs([20001003]);
  history.clearPrefabHistory();
  release(new Response(JSON.stringify(catalog)));
  await pending;
  assert.deepEqual(history.getPrefabHistory(), []);
  await history.recordAddedPrefabs([20001003]);
  const repeated = history.recordAddedPrefabs([20001003]);
  history.removePrefabHistory(20001003);
  await repeated;
  assert.deepEqual(history.getPrefabHistory(), []);
  await history.recordAddedPrefabs([20001003]);
  assert.equal(history.getPrefabHistory()[0].id, 20001003);
});
