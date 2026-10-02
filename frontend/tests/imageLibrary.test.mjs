import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function moduleUrl(path) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
}

const libraryUrl = moduleUrl("../src/imageLibrary.ts");
const library = await import(libraryUrl);
// 独立的最小测试样例，不读取或复制生产素材字典，也不用于运行时兜底。
const descriptions = [
  { assetID: 100006, description: "测试圆环", uses: ["avatar.frame"] },
  { assetID: 107083, description: "蓝色测试底板", uses: ["button.background"] },
  { assetID: 111001, description: "测试物品", uses: ["item.icon"] },
  { assetID: 112001, description: "测试角色", uses: ["character.portrait"] }
];
const taxonomy = {
  schemaVersion: 1,
  groups: [{ id: "content", label: "内容" }, { id: "control", label: "交互" }],
  uses: {
    "avatar.frame": { group: "content", label: "头像描边", keywords: ["头像框"] },
    "button.background": { group: "control", label: "按钮底板", keywords: [] },
    "item.icon": { group: "content", label: "物品图标", keywords: [] },
    "character.portrait": { group: "content", label: "角色肖像", keywords: [] }
  },
  filters: {
    "purpose.avatar": { group: "content", label: "头像与徽章底框", keywords: ["头像框"], uses: ["avatar.frame"] },
    "purpose.buttons": { group: "control", label: "按钮底板", keywords: [], uses: ["button.background"] },
    "purpose.characters": { group: "content", label: "角色展示", keywords: [], uses: ["character.portrait"] }
  }
};
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

test("fine and medium purposes intersect category and tone without changing shape categories", () => {
  assert.deepEqual(library.searchLibraryAssets(state, { use: "purpose.avatar" }).assets.map((asset) => asset.id), [100006]);
  for (const use of ["button.background", "purpose.buttons"]) {
    assert.equal(library.searchLibraryAssets(state, { use, category: "surface", tone: "color" }).matched, 1);
    assert.equal(library.searchLibraryAssets(state, { use, category: "item" }).matched, 0);
    assert.equal(library.searchLibraryAssets(state, { use, tone: "mono" }).matched, 0);
  }
  assert.deepEqual(library.searchLibraryAssets(state, { use: "group:content" }).assets.map((asset) => asset.id), [100006, 111001, 112001]);
  assert.equal(library.searchLibraryAssets(state, { query: "头像与徽章底框" }).matched, 1);
  assert.ok(state.groups.every((group) => !group.key.startsWith("purpose.")));
});

test("category and purpose discovery accept full labels and keep invalid filters explicit", () => {
  assert.equal(library.searchLibraryAssets(state, { category: "底板", use: "按钮底板", query: "蓝色" }).matched, 1);
  assert.equal(library.resolveLibraryUse(state, "角色展示"), "purpose.characters");
  assert.throws(() => library.searchLibraryAssets(state, { category: "made-up" }), /list_asset_categories/);
  assert.throws(() => library.searchLibraryAssets(state, { use: "made-up" }), /list_asset_uses/);
  assert.equal(library.filterLibraryAssetIds(state, ids, { use: "removed.purpose" }).length, 4);
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

test("purpose filters come from the published catalog; missing filters retain fine searches", () => {
  const { filters: _filters, ...legacyTaxonomy } = taxonomy;
  const legacy = library.toCatalogState({ ...payload, useTaxonomy: legacyTaxonomy }, "network", false);
  assert.deepEqual(legacy.useTaxonomy.filters, {});
  assert.equal(library.searchLibraryAssets(legacy, { use: "avatar.frame" }).matched, 1);
  assert.throws(() => library.searchLibraryAssets(legacy, { use: "purpose.avatar" }), /list_asset_uses/);
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
  assert.equal(library.filterLibraryAssetIds(basic, ids, { use: "purpose.avatar" }).length, 4);
  assert.deepEqual(library.filterLibraryAssetIds(basic, ids, { use: "purpose.avatar", query: "107083" }), [107083]);
});

test("missing purposes update automatically from old caches and cold loads without blocking browsing", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const storage = new Map();
  const { useTaxonomy: _taxonomy, descriptions: _descriptions, ...bare } = payload;
  globalThis.window = { localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  } };
  try {
    globalThis.fetch = async () => new Response(JSON.stringify(payload), { headers: { ETag: '"m2.fixture"' } });
    library.clearLibraryCache();
    await library.loadLibraryCatalog();
    const saved = [...storage.entries()];
    for (const mode of ["cached", "cold", "failure", "offline"]) {
      library.clearLibraryCache();
      if (mode === "cached") {
        for (const [key, value] of saved) storage.set(key, JSON.stringify({ ...JSON.parse(value), payload: bare }));
      }
      const calls = [];
      let finishRetry;
      const retry = new Promise((resolve) => { finishRetry = resolve; });
      globalThis.fetch = async (url, options) => {
        calls.push([url, options]);
        if (url.endsWith("?refresh=1")) return retry;
        return new Response(JSON.stringify(bare), { headers: { ETag: '"m2.degraded"' } });
      };
      let updated;
      const update = new Promise((resolve) => { updated = resolve; });
      const unsubscribe = library.subscribeLibraryCatalog((next) => {
        if (next.source === "network" && (mode === "failure" ? calls.length === 2 : Object.keys(next.useTaxonomy.filters).length > 0)) updated(next);
      });
      try {
        const initial = await library.loadLibraryCatalog();
        assert.equal(library.searchLibraryAssets(initial).matched, 4);
        assert.deepEqual(initial.useTaxonomy.filters, {});
        assert.equal(calls.at(-1)[0], "/api/library/catalog?refresh=1");
        assert.equal(calls.at(-1)[1].headers["If-None-Match"], undefined);
        finishRetry(mode === "offline"
          ? new Response("OSS unavailable", { status: 503 })
          : new Response(JSON.stringify(mode === "failure" ? bare : payload)));
        // HTTP 失败不发布新状态，等待该次后台请求的微任务处理完毕。
        if (mode === "offline") await new Promise(setImmediate);
        const next = mode === "offline" ? library.getCachedLibraryCatalog() : await update;
        assert.equal(library.searchLibraryAssets(next, { query: "107083" }).matched, 1);
        if (mode === "cached" || mode === "cold") assert.equal(library.searchLibraryAssets(next, { use: "purpose.avatar" }).matched, 1);
        assert.equal(calls.length, mode === "cached" ? 1 : 2);
      } finally {
        unsubscribe();
      }
    }
  } finally {
    library.clearLibraryCache();
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("failed refresh keeps the last catalog in memory or browser storage", async () => {
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
    globalThis.fetch = async () => new Response(JSON.stringify(payload), { headers: { ETag: '"m2.fixture"' } });
    await library.loadLibraryCatalog();
    const saved = [...storage.entries()];
    globalThis.fetch = async () => { throw new Error("OSS unavailable"); };
    storage.clear();
    const memory = await library.loadLibraryCatalog({ refresh: true });
    assert.equal(memory.source, "offline");
    assert.equal(library.searchLibraryAssets(memory, { query: "107083" }).matched, 1);

    library.clearLibraryCache();
    for (const [key, value] of saved) storage.set(key, value);
    const persisted = await library.loadLibraryCatalog({ refresh: true });
    assert.equal(persisted.source, "offline");
    assert.equal(library.searchLibraryAssets(persisted).matched, 4);

    library.clearLibraryCache();
    await assert.rejects(library.loadLibraryCatalog(), /OSS unavailable/);
  } finally {
    library.clearLibraryCache();
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
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
