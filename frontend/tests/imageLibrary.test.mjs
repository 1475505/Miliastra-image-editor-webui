import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function moduleUrl(path) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8").replace(
    'import bundledUseTaxonomy from "../../docs/category.json";',
    `const bundledUseTaxonomy = ${readFileSync(new URL("../../docs/category.json", import.meta.url), "utf8")};`
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
}

const libraryUrl = moduleUrl("../src/imageLibrary.ts");
const library = await import(libraryUrl);
const descriptions = JSON.parse(readFileSync(new URL("../../docs/desc.json", import.meta.url), "utf8"));
const taxonomy = JSON.parse(readFileSync(new URL("../../docs/category.json", import.meta.url), "utf8"));
const ids = [100006, 107083, 111001, 112001];
const payload = {
  images: Object.fromEntries([...ids.map((id) => [id, { id, img: `sprite/${id}.png` }]), [119999, { id: 119999, img: "" }]]),
  categories: { 8: { images: [100006] }, 2: { images: [107083] }, 9: { images: [111001] }, 12: { images: [112001, 119999] } },
  names: { "zh-CN": { 8: "基本形状", 2: "底板-彩色", 9: "物品-彩色", 12: "造物-彩色" } },
  descriptions: Object.fromEntries(descriptions.filter((row) => ids.includes(row.assetID)).map((row) => [row.assetID, row])),
  useTaxonomy: taxonomy
};
const state = library.toCatalogState(payload, "network", false);

test("Chinese use synonyms and full-width IDs find the ring", () => {
  for (const query of ["头像框", "avatar.frame", "１００００６ 头像框"]) {
    assert.deepEqual(library.searchLibraryAssets(state, { query }).assets.map((asset) => asset.id), [100006]);
  }
});

test("description and use terms must all match", () => {
  assert.deepEqual(library.searchLibraryAssets(state, { query: "蓝色 按钮底板" }).assets.map((asset) => asset.id), [107083]);
  assert.equal(library.searchLibraryAssets(state, { query: "红色 按钮底板" }).matched, 0);
});

test("purpose, category and tone filters intersect", () => {
  assert.equal(library.searchLibraryAssets(state, { use: "button.background", category: "surface", tone: "color" }).matched, 1);
  assert.equal(library.searchLibraryAssets(state, { use: "button.background", category: "item" }).matched, 0);
  assert.equal(library.searchLibraryAssets(state, { use: "button.background", tone: "mono" }).matched, 0);
  assert.deepEqual(library.searchLibraryAssets(state, { use: "group:content" }).assets.map((asset) => asset.id), [100006, 111001, 112001]);
});

test("medium purpose filters stay independent of original shape categories", () => {
  assert.deepEqual(library.searchLibraryAssets(state, { use: "purpose.avatar" }).assets.map((asset) => asset.id), [100006]);
  assert.equal(library.searchLibraryAssets(state, { use: "purpose.buttons", category: "surface", tone: "color" }).matched, 1);
  assert.equal(library.searchLibraryAssets(state, { use: "purpose.buttons", category: "item" }).matched, 0);
  assert.equal(library.searchLibraryAssets(state, { use: "purpose.buttons", tone: "mono" }).matched, 0);
  assert.equal(library.searchLibraryAssets(state, { use: "avatar.frame" }).matched, 1);
  assert.equal(library.searchLibraryAssets(state, { query: "头像与徽章底框" }).matched, 1);
  assert.ok(state.groups.every((group) => !group.key.startsWith("purpose.")));
});

test("category and purpose discovery accept full labels and keep invalid filters explicit", () => {
  assert.equal(library.searchLibraryAssets(state, { category: "底板", use: "按钮底板", query: "蓝色" }).matched, 1);
  assert.equal(library.resolveLibraryUse(state, "角色展示"), "purpose.characters");
  assert.throws(() => library.searchLibraryAssets(state, { category: "made-up" }), /list_asset_categories/);
  assert.throws(() => library.searchLibraryAssets(state, { use: "made-up" }), /list_asset_uses/);
  assert.equal(library.filterLibraryAssetIds(state, ids, { use: "removed.purpose" }).length, 0);
  const iconState = library.toCatalogState({ ...payload,
    categories: { 3: { images: [100006] }, 15: { images: [107083] }, 17: { images: [112001] }, 9: { images: [111001] } },
    names: { "zh-CN": { 3: "功能图标-单色", 15: "玩法图标-彩色", 17: "技能图标-彩色", 9: "物品-彩色" } }
  }, "network", false);
  assert.deepEqual(library.queryLibraryAssetIds(iconState, { category: "图标" }), [100006, 107083, 112001]);
  assert.deepEqual(library.queryLibraryAssetIds(iconState, { category: "图标", use: "purpose.avatar", tone: "mono" }), [100006]);
  const categories = library.listLibraryAssetCategories(iconState, { query: "图标", tone: "mono" });
  assert.equal(categories.find((category) => category.key === "icons").count, 1);
  assert.ok(iconState.groups.every((group) => group.key !== "icons"));
});

test("old OSS dictionaries use bundled purpose filters; published filters take priority", () => {
  const { filters: _filters, ...legacyTaxonomy } = taxonomy;
  const legacy = library.toCatalogState({ ...payload, useTaxonomy: legacyTaxonomy }, "network", false);
  assert.equal(Object.keys(legacy.useTaxonomy.filters).length, Object.keys(taxonomy.filters).length);
  assert.equal(library.searchLibraryAssets(legacy, { use: "purpose.avatar" }).matched, 1);
  const published = library.toCatalogState({ ...payload, useTaxonomy: { ...taxonomy, filters: {
    "purpose.custom": { group: "content", label: "Custom avatars", keywords: [], uses: ["avatar.frame", "invalid.code"] }
  } } }, "network", false);
  assert.deepEqual(Object.keys(published.useTaxonomy.filters), ["purpose.custom"]);
  assert.deepEqual(published.useTaxonomy.filters["purpose.custom"].uses, ["avatar.frame"]);
  assert.equal(library.searchLibraryAssets(published, { use: "purpose.custom" }).matched, 1);
});

test("pagination excludes missing images and returns descriptions with usable URLs", () => {
  const first = library.searchLibraryAssets(state, { limit: 2 });
  const second = library.searchLibraryAssets(state, { offset: first.nextOffset, limit: 2 });
  assert.equal(first.matched, 4);
  assert.deepEqual([...first.assets, ...second.assets].map((asset) => asset.id), ids);
  assert.equal(second.nextOffset, null);
  assert.ok(first.assets[0].description.includes("圆环"));
  assert.ok(first.assets[0].useLabels.includes("头像描边"));
  assert.equal(first.assets[0].imageUrl, "https://oss.070077.xyz/images/sprite/100006.png");
});

test("catalog without optional annotations still supports browsing and ID search", () => {
  const { descriptions: _desc, useTaxonomy: _uses, ...bare } = payload;
  const basic = library.toCatalogState(bare, "network", false);
  assert.equal(library.searchLibraryAssets(basic).matched, 4);
  assert.equal(library.searchLibraryAssets(basic, { query: "107083" }).matched, 1);
  assert.throws(() => library.searchLibraryAssets(basic, { use: "button.background" }), /list_asset_uses/);
  assert.equal(library.filterLibraryAssetIds(basic, ids, { use: "purpose.avatar" }).length, 0);
});

test("catalog refresh and AI tools share the enriched index", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const storage = new Map();
  const calls = [];
  let networkPayload = payload;
  globalThis.window = { localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  } };
  globalThis.fetch = async (url, options) => {
    calls.push([url, options]);
    if (url === "/api/library/contact-sheet") return new Response(Uint8Array.of(137, 80, 78, 71), { headers: { "Content-Type": "image/png", "X-Failed-Asset-IDs": "100006" } });
    return new Response(JSON.stringify(networkPayload), { headers: { ETag: '"m2.fixture"' } });
  };
  try {
    library.clearLibraryCache();
    const loaded = await library.loadLibraryCatalog();
    assert.equal(loaded.assets[100006].description, payload.descriptions[100006].description);
    await library.loadLibraryCatalog();
    assert.equal(calls.length, 1);
    await library.loadLibraryCatalog({ refresh: true });
    assert.equal(calls[1][0], "/api/library/catalog?refresh=1");
    assert.ok([...storage.keys()].some((key) => key.includes(":v2:catalog")));

    const toolsSource = readFileSync(new URL("../src/webmcp.ts", import.meta.url), "utf8");
    const transpiled = ts.transpileModule(toolsSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
    const toolsUrl = `data:text/javascript;base64,${Buffer.from(transpiled.replace('"./imageLibrary"', JSON.stringify(libraryUrl))).toString("base64")}`;
    const definitions = new Map();
    const originalDocument = globalThis.document;
    globalThis.document = { modelContext: { registerTool: async (definition) => definitions.set(definition.name, definition) } };
    try {
      const tools = await import(toolsUrl);
      const dispose = tools.registerEditorTools(() => ({}));
      const search = definitions.get("search_assets");
      assert.equal(search.annotations.readOnlyHint, true);
      const result = await search.execute({ query: "头像框" }, {});
      assert.equal(result.ok, true);
      assert.deepEqual(result.assets.map((asset) => asset.id), [100006]);
      assert.equal((await search.execute({ tone: "invalid" }, {})).ok, false);
      const uses = await definitions.get("list_asset_uses").execute({ query: "头像框", includeFine: true }, {});
      assert.deepEqual(uses.uses.map((entry) => entry.code), ["avatar.frame"]);
      assert.equal(uses.filters.find((entry) => entry.code === "purpose.avatar").count, 1);
      assert.ok(uses.categories.some((entry) => entry.key === "surface"));
      assert.equal((await search.execute({ use: "purpose.avatar" }, {})).matched, 1);
      assert.equal((await search.execute({ category: "not-a-category" }, {})).ok, false);
      const categories = await definitions.get("list_asset_categories").execute({}, {});
      assert.equal(categories.categories.find((entry) => entry.key === "surface").count, 1);
      const scopedUses = await definitions.get("list_asset_uses").execute({ category: "底板", tone: "color" }, {});
      assert.equal(scopedUses.matched, 1);
      assert.deepEqual(scopedUses.filters.map((entry) => entry.code), ["purpose.buttons"]);
      assert.deepEqual(scopedUses.uses, []);
      const packTool = definitions.get("prepare_asset_pack");
      const pack = await packTool.execute({ category: "底板", use: "按钮底板" }, {});
      assert.equal(pack.count, 1);
      assert.deepEqual(pack.request.body, { ids: [107083] });
      assert.ok(pack.downloadUrl.includes("/api/library/assets.zip?ids=107083"));
      assert.equal((await packTool.execute({ ids: [107083], category: "surface" }, {})).ok, false);
      assert.equal((await packTool.execute({ ids: [119999] }, {})).ok, false);
      assert.equal((await packTool.execute({}, {})).ok, false);
      assert.equal((await packTool.execute({ all: true, query: "" }, {})).ok, false);
      const emptyPack = await packTool.execute({ query: "no-such-keyword" }, {});
      assert.equal(emptyPack.count, 0);
      assert.equal(emptyPack.request, null);
      const preview = await definitions.get("preview_assets").execute({ ids: [100006, 107083, 100006], limit: 1 }, {});
      assert.deepEqual(preview.ids, [100006]);
      assert.equal(preview.matched, 2);
      assert.equal(preview.nextOffset, 1);
      assert.equal(preview.content[0].type, "image");
      assert.deepEqual(preview.failedIds, [100006]);
      assert.deepEqual(JSON.parse(calls.at(-1)[1].body), { ids: [100006] });
      const second = await definitions.get("preview_assets").execute({ ids: [100006, 107083], offset: 1, output: "dataUrl" }, {});
      assert.deepEqual(second.ids, [107083]);
      assert.ok(second.dataUrl.startsWith("data:image/png;base64,"));
      assert.equal((await definitions.get("preview_assets").execute({ limit: 49 }, {})).ok, false);
      const manyIds = Array.from({ length: 320 }, (_, index) => 101000 + index);
      networkPayload = { ...payload, images: Object.fromEntries(manyIds.map((id) => [id, { id, img: `sprite/${id}.png` }])), categories: { 2: { images: manyIds } } };
      const large = await packTool.execute({ category: "surface", refresh: true }, {});
      assert.equal(large.count, 320);
      assert.equal(large.request.body.ids.length, 320);
      assert.equal(large.downloadUrl, null);
      const all = await packTool.execute({ all: true }, {});
      assert.equal(all.count, 320);
      assert.deepEqual(all.request.body, { all: true });
      assert.ok(all.downloadUrl.endsWith("all=true"));
      dispose();
    } finally {
      globalThis.document = originalDocument;
    }
  } finally {
    library.clearLibraryCache();
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});
