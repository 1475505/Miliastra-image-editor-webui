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
const tools = await import(moduleUrl("../src/webmcp.ts", [["./prefabLibrary", prefabUrl], ["./imageLibrary", assetsUrl]]));

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
