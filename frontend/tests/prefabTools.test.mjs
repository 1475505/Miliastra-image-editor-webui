import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function moduleUrl(path, replacements = []) {
  let text = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
  for (const [from, to] of replacements) text = text.replace(JSON.stringify(from), JSON.stringify(to));
  return `data:text/javascript;base64,${Buffer.from(text).toString("base64")}`;
}
const prefabUrl = moduleUrl("../src/prefabLibrary.ts");
const assetsUrl = moduleUrl("../src/imageLibrary.ts");
const stretchUrl = moduleUrl("../src/imageStretch.ts");
const library = await import(assetsUrl);
const tools = await import(moduleUrl("../src/webmcp.ts", [["./prefabLibrary", prefabUrl], ["./imageLibrary", assetsUrl], ["./imageStretch", stretchUrl], ["./rotation", moduleUrl("../src/rotation.ts")], ["./luaMask", moduleUrl("../src/luaMask.ts")]]));

test("mask tools preserve partial native values and reject malformed updates", async () => {
  const old = globalThis.document, definitions = new Map(), edits = [];
  globalThis.document = { modelContext: { registerTool: async tool => definitions.set(tool.name, tool) } };
  const dispose = tools.registerEditorTools(() => ({
    getScene: () => ({ elements: [{ id: "text", type: "textbox" }] }),
    updateElements: updates => { edits.push(updates); return { ok: true }; }
  }));
  try {
    const execute = args => definitions.get("update_element").execute({ id: "text", ...args }, {});
    assert.equal(definitions.get("update_element").inputSchema.properties.luaMask.properties.imageId.default, 100001);
    assert.deepEqual(definitions.get("update_element").inputSchema.properties.luaMask.properties.imageType.enum, ["basic", "stretch", null]);
    assert.equal((await execute({ luaMask: { imageId: 100002, imageType: "basic", enableSoftEdge: true, softEdgeMode: "Percentage", horizontalSoftRange: 82 } })).ok, true);
    assert.deepEqual(edits[0][0].patch.luaMask, { imageId: 100002, imageType: "basic", enableSoftEdge: true, softEdgeMode: "Percentage", horizontalSoftRange: 82 });
    for (const luaMask of [{ width: -1 }, { enabled: 1 }, { softEdgeMode: "percent" }, { softEdgeWidthX: Infinity }, { imageId: 0 }, { imageId: 1.5 }, { imageId: true }, { imageId: 2147483648 }, { imageType: "Basic" }, { imageType: true }]) {
      assert.equal((await execute({ luaMask })).ok, false);
    }
    assert.equal((await execute({ luaMask: { imageType: "stretch" } })).ok, true);
    assert.deepEqual(edits[1][0].patch.luaMask, { imageType: "stretch" });
    assert.equal((await execute({ luaMask: { imageType: null } })).ok, true);
    assert.deepEqual(edits[2][0].patch.luaMask, { imageType: null });
    assert.equal((await execute({ luaMask: null })).ok, true);
    assert.equal(edits.length, 4);
  } finally { dispose(); globalThis.document = old; }
});

test("image tools preserve Basic/Stretch and reject invalid or misplaced modes atomically", async () => {
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 106030, border: { left: 45, right: 45, top: 45, bottom: 45 } }));
  const definitions = new Map();
  globalThis.document = { modelContext: { registerTool: async (tool) => definitions.set(tool.name, tool) } };
  const edits = [];
  const dispose = tools.registerEditorTools(() => ({
    getScene: () => ({ elements: [{ id: "i", type: "image", imageAssetId: 106030, imageType: "stretch" }] }),
    addElements: (inputs) => { edits.push(inputs); return { ok: true, elements: inputs, count: inputs.length }; },
    updateElements: (updates) => { edits.push(updates); return { ok: true }; }
  }));
  try {
    const execute = (name, args) => definitions.get(name).execute(args, {});
    assert.deepEqual(definitions.get("add_element").inputSchema.properties.imageType.enum, ["basic", "stretch"]);
    const added = await execute("add_element", { type: "image", imageAssetId: 106030, imageType: "stretch" });
    assert.equal(added.element.imageType, "stretch");
    assert.equal((await execute("update_element", { id: "i", imageType: "basic" })).ok, true);
    assert.deepEqual(edits[1], [{ id: "i", patch: { imageType: "basic" } }]);
    for (const imageType of ["slice", "Stretch", 1, null]) {
      assert.equal((await execute("update_element", { id: "i", imageType })).ok, false);
    }
    assert.equal((await execute("add_element", { type: "rectangle", imageType: "stretch" })).ok, false);
    assert.equal((await execute("add_elements", { elements: [
      { type: "image", imageAssetId: 106030, imageType: "stretch" },
      { type: "rectangle", imageType: "basic" }
    ] })).ok, false);
    assert.equal(edits.length, 2);
  } finally { dispose(); globalThis.document = originalDocument; globalThis.fetch = originalFetch; }
});

test("image tools resolve defaults and resource changes before committing a batch", async () => {
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  const definitions = new Map();
  globalThis.document = { modelContext: { registerTool: async (tool) => definitions.set(tool.name, tool) } };
  library.clearLibraryCache();
  globalThis.fetch = async (url) => {
    const id = Number(url.split("/").at(-1));
    const sizes = { 106030: [90, 90], 100001: [20, 30], 105222: [17, 23], 105114: [144, 100], 105115: [8, 17] };
    const [width, height] = sizes[id] ?? [96, 96];
    return new Response(JSON.stringify({ id, width, height, border: id === 106030 ?
      { left: 45, right: 45, top: 45, bottom: 45 } : id === 105114 ?
      { left: 72, right: 72, top: 0, bottom: 0 } : id === 105115 ?
      { left: 0, right: 0, top: 5, bottom: 5 } : { left: 0, right: 0, top: 0, bottom: 0 } }));
  };
  const edits = [];
  const dispose = tools.registerEditorTools(() => ({
    getScene: () => ({ elements: [{ id: "i", type: "image", imageAssetId: 100001, imageType: "basic" }] }),
    addElements: (inputs) => { edits.push(inputs); return { ok: true, elements: inputs, count: inputs.length }; },
    updateElements: (updates) => { edits.push(updates); return { ok: true }; }
  }));
  try {
    const execute = (name, args) => definitions.get(name).execute(args, {});
    const result = await execute("add_elements", { returnElements: true, elements: [
      { type: "image", imageAssetId: 106030 },
      { type: "image", imageAssetId: 100001, imageType: "stretch" },
      { type: "image", imageAssetId: 105222 },
      { type: "image", imageAssetId: 106030, imageType: "basic", width: 312, height: 87 },
      { type: "image", imageAssetId: 105114 },
      { type: "image", imageAssetId: 105115 }
    ] });
    assert.deepEqual(result.elements.map((element) => element.imageType), ["stretch", "basic", "basic", "basic", "stretch", "stretch"]);
    assert.deepEqual(result.elements.map(({ width, height }) => [width, height]),
      [[136, 96], [20, 30], [17, 23], [312, 87], [136, 100], [8, 96]]);
    await execute("update_element", { id: "i", imageAssetId: 106030 });
    assert.equal(edits[1][0].patch.imageType, "stretch");
    assert.equal(edits[1][0].patch.width, undefined);
    assert.equal(edits[1][0].patch.height, undefined);
    await execute("update_element", { id: "i", imageType: "stretch" });
    assert.equal(edits[2][0].patch.imageType, "basic");
  } finally { dispose(); globalThis.document = originalDocument; globalThis.fetch = originalFetch; }
});

test("Prefab tools validate catalog IDs before atomic add/update, with Lua configuration names", async () => {
  const storage = new Map();
  globalThis.window = { localStorage: { getItem: (key) => storage.get(key), setItem: (key, v) => storage.set(key, v) } };
  const definitions = new Map();
  globalThis.document = { modelContext: { registerTool: async (tool) => definitions.set(tool.name, tool) } };
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    return new Response(JSON.stringify({ schemaVersion: 2, categories: {}, prefabs: {
      20001003: { id: 20001003, img: "sprite/20001003.png", imageUrl: "https://oss.example/prefabs/sprite/20001003.png", width: 256, height: 128, categoryIds: [] },
      20001303: { id: 20001303, img: null, imageUrl: null, width: null, height: null, categoryIds: [] }
    } }));
  };
  const edits = [];
  const dispose = tools.registerEditorTools(() => ({
    addElements: (inputs) => { edits.push(inputs); return { ok: true, elements: inputs, count: inputs.length }; },
    updateElements: (updates) => { edits.push(updates); return { ok: true }; }
  }));
  try {
    const execute = (name, args) => definitions.get(name).execute(args, {});
    const result = await execute("add_element", { type: "prefab", prefabId: 20001003 });
    assert.equal(result.ok, true);
    assert.equal(result.element.prefabVariable, "prefab_20001003");
    assert.equal(result.element.width, 256);
    assert.equal(result.element.height, 128);
    for (const fields of [{ prefabId: 99999999 }, { prefabId: 20001303 }, { prefabId: "20001003" }, { prefabId: 20001003, prefabVariable: "" }]) {
      assert.equal((await execute("add_element", { type: "prefab", ...fields })).ok, false);
    }
    assert.equal((await execute("add_elements", { elements: [{ type: "rectangle" }, { type: "prefab", prefabId: 99999999 }] })).ok, false);
    assert.equal(edits.length, 1);
    assert.equal((await execute("update_element", { id: "p", prefabVariable: "竹子变量" })).ok, true);
    assert.equal((await execute("update_element", { id: "p", prefabId: 99999999 })).ok, false);
    assert.equal(edits.length, 2);
    assert.deepEqual(requests, ["/api/prefabs/catalog"]);
  } finally { dispose(); }
});
