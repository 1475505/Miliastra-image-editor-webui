/**
 * 图片素材库（Public/CustomUIImage）前端数据层。
 *
 * 后端只做无状态代理（OSS 没有 CORS 头，fetch 拿不到 data.json），
 * 缓存全部落在浏览器这一侧：
 * 1. HTTP 缓存：索引响应带 OSS 的 ETag 与 12 小时 max-age，窗口内浏览器不回访
 * 2. localStorage：首屏直接渲染，窗口过期后带 If-None-Match 静默校验（服务端转译成上游条件请求，命中即 304）
 * 3. 图片本体直连 OSS，交给浏览器 HTTP 缓存（OSS 返回 max-age=43200）+ 懒加载
 *
 * 元数据（尺寸 / 九宫格）只在用户选中素材时按需拉取，并长期缓存在 localStorage。
 */

const API_BASE = "/api/library";
export const OSS_IMAGE_BASE = "https://oss.070077.xyz/images";

const CACHE_VERSION = 1;
const CATALOG_CACHE_KEY = `miliastra:image-library:v${CACHE_VERSION}:catalog`;
const META_CACHE_KEY = `miliastra:image-library:v${CACHE_VERSION}:meta`;

const CATALOG_TTL_MS = 12 * 60 * 60 * 1000;
const META_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const META_CACHE_LIMIT = 400;

export type LibraryTone = "mono" | "color";
export type CacheSource = "network" | "browser" | "offline";

export type LibraryToneBucket = {
  tone: LibraryTone | null;
  label: string;
  ids: number[];
};

export type LibraryGroup = {
  key: string;
  label: string;
  ids: number[];
  tones: LibraryToneBucket[];
};

export type SpriteMeta = {
  id: number;
  width: number;
  height: number;
  stretchable: boolean;
  border: { left: number; bottom: number; right: number; top: number };
  pivot: { x: number; y: number };
};

export type LibraryCatalogState = {
  groups: LibraryGroup[];
  total: number;
  /** 索引里存在、归属分类但没有图片文件的条目数（浏览时隐藏） */
  hiddenCount: number;
  source: CacheSource;
  fetchedAt: number;
  /** 本次渲染是否直接用了浏览器缓存 */
  fromBrowserCache: boolean;
};

type CatalogPayload = {
  images?: Record<string, { id?: number; img?: string; border?: string }>;
  categories?: Record<string, { id?: number; images?: number[] }>;
  names?: Record<string, Record<string, string>>;
};

type CachedRecord<T> = { version: number; etag: string | null; fetchedAt: number; payload: T };
type MetaRecord = { fetchedAt: number; meta: SpriteMeta | null };

/**
 * 分类 ID → 一级分组的稳定映射。ID 比名称可靠，名称只用来取显示文案。
 * 未收录的新分类会按名称自动建组，不会丢素材。
 */
const GROUP_DEFINITIONS: { key: string; categoryIds: number[] }[] = [
  { key: "function-icon", categoryIds: [3, 4] },
  { key: "gameplay-icon", categoryIds: [15, 16] },
  { key: "ornament", categoryIds: [5, 6] },
  { key: "surface", categoryIds: [1, 2] },
  { key: "basic-shape", categoryIds: [8] },
  { key: "divider", categoryIds: [18] },
  { key: "special-character", categoryIds: [7] },
  { key: "skill-talent", categoryIds: [17] },
  { key: "item", categoryIds: [9] },
  { key: "creation", categoryIds: [12] },
];

const TONE_KEYWORDS: { tone: LibraryTone; labels: string }[] = [
  { tone: "mono", labels: "单色 Monochrome" },
  { tone: "color", labels: "彩色 Color" },
];

const listeners = new Set<(state: LibraryCatalogState) => void>();
const metaMemory = new Map<number, SpriteMeta | null>();

let catalogCache: LibraryCatalogState | null = null;
let inflight: Promise<LibraryCatalogState> | null = null;

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readJson<T>(key: string): T | null {
  const storage = safeStorage();
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  const storage = safeStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // 配额不足时静默降级为纯内存缓存
  }
}

/** 把「功能图标-单色」/「Surface - Monochrome」拆成基名与色态。 */
export function splitCategoryName(name: string): { base: string; tone: LibraryTone | null; toneLabel: string | null } {
  const parts = name.split(/\s*-\s*/);
  const base = parts[0]?.trim() || name.trim();
  const suffix = parts.slice(1).join(" - ").trim();
  if (!suffix) {
    return { base, tone: null, toneLabel: null };
  }
  const normalized = suffix.toLowerCase();
  for (const entry of TONE_KEYWORDS) {
    const hits = entry.labels.split(" ").some((keyword) => normalized.includes(keyword.toLowerCase()));
    if (hits) {
      return { base, tone: entry.tone, toneLabel: suffix };
    }
  }
  return { base, tone: null, toneLabel: suffix };
}

function categoryName(payload: CatalogPayload, categoryId: string): string {
  const names = payload.names ?? {};
  return names["zh-CN"]?.[categoryId] ?? names["en-US"]?.[categoryId] ?? categoryId;
}

/** 索引中存在、但没有图片本体的条目（实测 21 条），浏览时应隐藏。 */
export function collectMissingIds(payload: CatalogPayload): Set<number> {
  const missing = new Set<number>();
  Object.entries(payload.images ?? {}).forEach(([key, value]) => {
    const id = Number(value?.id ?? key);
    if (!Number.isFinite(id)) {
      return;
    }
    if (!value?.img) {
      missing.add(id);
    }
  });
  return missing;
}

export function countHiddenIds(payload: CatalogPayload, missing: Set<number>): number {
  const hidden = new Set<number>();
  Object.values(payload.categories ?? {}).forEach((group) => {
    (group.images ?? []).forEach((id) => {
      if (missing.has(id)) {
        hidden.add(id);
      }
    });
  });
  return hidden.size;
}

export function buildGroups(payload: CatalogPayload, missing: Set<number> = collectMissingIds(payload)): LibraryGroup[] {
  const categories = payload.categories ?? {};
  const buckets = new Map<string, { label: string; order: number; tones: Map<string, LibraryToneBucket> }>();

  Object.entries(categories).forEach(([categoryId, group]) => {
    const ids = (group.images ?? []).filter((id): id is number => Number.isFinite(id) && !missing.has(id));
    if (!ids.length) {
      return;
    }
    const numericId = Number(categoryId);
    const definitionIndex = GROUP_DEFINITIONS.findIndex((item) => item.categoryIds.includes(numericId));
    const name = categoryName(payload, categoryId);
    const { base, tone, toneLabel } = splitCategoryName(name);
    const key = definitionIndex >= 0 ? GROUP_DEFINITIONS[definitionIndex].key : `extra-${base}`;
    const order = definitionIndex >= 0 ? definitionIndex : GROUP_DEFINITIONS.length;

    if (!buckets.has(key)) {
      buckets.set(key, { label: base, order, tones: new Map() });
    }
    const bucket = buckets.get(key)!;
    const toneKey = tone ?? "flat";
    const existing = bucket.tones.get(toneKey);
    if (existing) {
      existing.ids.push(...ids);
    } else {
      bucket.tones.set(toneKey, { tone, label: toneLabel ?? base, ids: [...ids] });
    }
  });

  const toneOrder: (LibraryTone | null)[] = ["mono", "color", null];

  return [...buckets.entries()]
    .map(([key, bucket]) => {
      const tones = [...bucket.tones.values()].sort(
        (a, b) => toneOrder.indexOf(a.tone) - toneOrder.indexOf(b.tone)
      );
      return {
        key,
        label: bucket.label,
        order: bucket.order,
        ids: tones.flatMap((tone) => tone.ids).sort((a, b) => a - b),
        tones,
      };
    })
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...group }) => group);
}

function emit(state: LibraryCatalogState): void {
  catalogCache = state;
  listeners.forEach((listener) => listener(state));
}

export function subscribeLibraryCatalog(listener: (state: LibraryCatalogState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCachedLibraryCatalog(): LibraryCatalogState | null {
  return catalogCache;
}

function readCatalogCache(): CachedRecord<CatalogPayload> | null {
  const record = readJson<CachedRecord<CatalogPayload>>(CATALOG_CACHE_KEY);
  if (!record || record.version !== CACHE_VERSION || !record.payload) {
    return null;
  }
  return record;
}

function toState(payload: CatalogPayload, source: CacheSource, fromBrowserCache: boolean): LibraryCatalogState {
  const missing = collectMissingIds(payload);
  const groups = buildGroups(payload, missing);
  return {
    groups,
    total: groups.reduce((sum, group) => sum + group.ids.length, 0),
    hiddenCount: countHiddenIds(payload, missing),
    source,
    fetchedAt: Date.now(),
    fromBrowserCache,
  };
}

type CatalogResponse =
  | { notModified: true; etag: string | null }
  | { notModified: false; etag: string | null; payload: CatalogPayload };

async function requestCatalog(options: { refresh: boolean; etag?: string | null }): Promise<CatalogResponse> {
  const { refresh, etag } = options;
  // 刷新时绕过浏览器缓存；校验时也走 no-store，由我们自己的 If-None-Match 控制成本
  const url = refresh ? `${API_BASE}/catalog?refresh=1` : `${API_BASE}/catalog`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (!refresh && etag) {
    headers["If-None-Match"] = etag;
  }
  const response = await fetch(url, { headers, cache: "no-store" });
  if (response.status === 304) {
    return { notModified: true, etag: response.headers.get("ETag") ?? etag ?? null };
  }
  if (!response.ok) {
    throw new Error(`素材索引请求失败（HTTP ${response.status}）`);
  }
  const payload = (await response.json()) as CatalogPayload;
  return { notModified: false, payload, etag: response.headers.get("ETag") };
}

async function revalidate(): Promise<void> {
  const cached = readCatalogCache();
  if (!cached) {
    return;
  }
  try {
    const result = await requestCatalog({ refresh: false, etag: cached.etag });
    if (result.notModified) {
      writeJson(CATALOG_CACHE_KEY, { ...cached, etag: result.etag ?? cached.etag, fetchedAt: Date.now() / 1000 });
      emit(toState(cached.payload, "browser", true));
      return;
    }
    writeJson(CATALOG_CACHE_KEY, {
      version: CACHE_VERSION,
      etag: result.etag,
      fetchedAt: Date.now() / 1000,
      payload: result.payload,
    });
    emit(toState(result.payload, "network", false));
  } catch {
    // 后台校验失败不影响已渲染内容
  }
}

export async function loadLibraryCatalog(options: { refresh?: boolean } = {}): Promise<LibraryCatalogState> {
  const { refresh = false } = options;
  if (!refresh && catalogCache) {
    return catalogCache;
  }

  const cached = refresh ? null : readCatalogCache();
  const age = cached ? Date.now() - cached.fetchedAt * 1000 : Number.POSITIVE_INFINITY;

  if (cached && age < CATALOG_TTL_MS) {
    const state = toState(cached.payload, "browser", true);
    emit(state);
    void revalidate();
    return state;
  }

  if (inflight) {
    return inflight;
  }

  inflight = (async () => {
    try {
      const result = await requestCatalog({ refresh, etag: refresh ? null : cached?.etag });
      if (result.notModified && cached) {
        writeJson(CATALOG_CACHE_KEY, { ...cached, etag: result.etag ?? cached.etag, fetchedAt: Date.now() / 1000 });
        const state = toState(cached.payload, "browser", true);
        emit(state);
        return state;
      }
      if (!result.notModified) {
        writeJson(CATALOG_CACHE_KEY, {
          version: CACHE_VERSION,
          etag: result.etag,
          fetchedAt: Date.now() / 1000,
          payload: result.payload,
        });
        const state = toState(result.payload, "network", false);
        emit(state);
        return state;
      }
      throw new Error("素材索引返回了意外的空响应");
    } catch (error) {
      if (cached) {
        const state = toState(cached.payload, "offline", true);
        emit(state);
        return state;
      }
      throw error;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function imageUrl(imageId: number): string {
  return `${OSS_IMAGE_BASE}/sprite/${imageId}.png`;
}

export function borderPath(imageId: number): string {
  return `${OSS_IMAGE_BASE}/border/${imageId}.json`;
}

/**
 * 同源贴图地址，专供 CSS 遮罩（染色）使用。
 * CSS mask 要求资源 CORS-same-origin —— 直接用 OSS 地址会让元素整块消失
 * （实测：跨域遮罩的元素像素完全透明），因此染色走本代理。
 * 彩色素材的 <img> 仍然直连 OSS，不消耗后端带宽。
 */
export function assetMaskUrl(imageId: number): string {
  return `${API_BASE}/sprite/${imageId}.png`;
}

export function readMetaCache(imageId: number): SpriteMeta | null | undefined {
  if (metaMemory.has(imageId)) {
    return metaMemory.get(imageId);
  }
  const store = readJson<Record<string, MetaRecord>>(META_CACHE_KEY) ?? {};
  const record = store[String(imageId)];
  if (!record) {
    return undefined;
  }
  if (Date.now() - record.fetchedAt > META_TTL_MS) {
    return undefined;
  }
  metaMemory.set(imageId, record.meta);
  return record.meta;
}

function writeMetaCache(imageId: number, meta: SpriteMeta | null): void {
  metaMemory.set(imageId, meta);
  const store = readJson<Record<string, MetaRecord>>(META_CACHE_KEY) ?? {};
  store[String(imageId)] = { fetchedAt: Date.now(), meta };
  const entries = Object.entries(store);
  if (entries.length > META_CACHE_LIMIT) {
    entries
      .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
      .slice(META_CACHE_LIMIT)
      .forEach(([key]) => delete store[key]);
  }
  writeJson(META_CACHE_KEY, store);
}

export async function loadSpriteMeta(imageId: number): Promise<SpriteMeta | null> {
  const cached = readMetaCache(imageId);
  if (cached !== undefined) {
    return cached;
  }
  const response = await fetch(`${API_BASE}/meta/${imageId}`, { headers: { Accept: "application/json" } });
  if (response.status === 404) {
    writeMetaCache(imageId, null);
    return null;
  }
  if (!response.ok) {
    throw new Error(`素材元数据请求失败（HTTP ${response.status}）`);
  }
  const meta = (await response.json()) as SpriteMeta;
  writeMetaCache(imageId, meta);
  return meta;
}

export function clearLibraryCache(): void {
  const storage = safeStorage();
  if (!storage) {
    return;
  }
  [CATALOG_CACHE_KEY, META_CACHE_KEY].forEach((key) => storage.removeItem(key));
  metaMemory.clear();
  catalogCache = null;
}
