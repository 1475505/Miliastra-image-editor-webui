/** Prefab information is fetched only on an ID lookup; no gallery is built. */
export type PrefabCategory = { id: number; names: Record<string, string> };
export type PrefabRecord = {
  id: number;
  img: string | null;
  imageUrl: string | null;
  width: number | null;
  height: number | null;
  names: Record<string, string>;
  descriptions?: Record<string, string>;
  entityType: "Gadget" | "Monster" | "Level";
  baseId?: number | null;
  gadgetId?: number | null;
  listIds?: number[];
  categoryIds: number[];
  jsonName?: string | null;
};
type PrefabCatalog = {
  schemaVersion: 1 | 2;
  prefabs: Record<string, PrefabRecord>;
  categories: Record<string, PrefabCategory>;
  source: { build?: string; commit?: string };
};
type CachedCatalog = { payload: PrefabCatalog; etag: string | null; fetchedAt: number };
export type PrefabInfo = PrefabRecord & { categories: PrefabCategory[]; source: PrefabCatalog["source"]; stale: boolean };
export class PrefabLookupError extends Error {
  constructor(public readonly kind: "invalid-id" | "not-found" | "unavailable") {
    super(kind);
    this.name = "PrefabLookupError";
  }
}

const CACHE_KEY = "miliastra:prefab-library:v2";
const TTL_MS = 12 * 60 * 60 * 1000;
let memory: CachedCatalog | null = null;
let inflight: Promise<{ record: CachedCatalog; stale: boolean }> | null = null;

export function normalizePrefabId(value: string | number): string {
  const candidate = String(value).normalize("NFKC").trim().replace(/\.png$/i, "");
  if (!/^[1-9][0-9]{0,9}$/.test(candidate) || Number(candidate) > 0xffffffff) {
    throw new PrefabLookupError("invalid-id");
  }
  return candidate;
}

function isCatalog(value: unknown): value is PrefabCatalog {
  const v = value as Partial<PrefabCatalog> | null;
  return !!v && (v.schemaVersion === 1 || v.schemaVersion === 2) && !!v.prefabs && typeof v.prefabs === "object" && !Array.isArray(v.prefabs) &&
    !!v.categories && typeof v.categories === "object" && !Array.isArray(v.categories);
}

function readCache(): CachedCatalog | null {
  if (memory) return memory;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const value = raw ? JSON.parse(raw) as CachedCatalog : null;
    if (value && isCatalog(value.payload) && Number.isFinite(value.fetchedAt)) memory = value;
  } catch { /* Storage may be unavailable; keep the lookup usable. */ }
  return memory;
}

function saveCache(record: CachedCatalog): void {
  memory = record;
  try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(record)); } catch { /* Memory/HTTP caching still works. */ }
}

async function loadCatalog(refresh: boolean): Promise<{ record: CachedCatalog; stale: boolean }> {
  const cached = readCache();
  if (!refresh && cached && Date.now() - cached.fetchedAt < TTL_MS) return { record: cached, stale: false };
  if (inflight && !refresh) return inflight;
  const pending = (async () => {
    try {
      const response = await fetch(`/api/prefabs/catalog${refresh ? "?refresh=1" : ""}`, {
        headers: !refresh && cached?.etag ? { "If-None-Match": cached.etag } : {},
        cache: "no-cache"
      });
      if (response.status === 304 && cached) {
        const record = { ...cached, fetchedAt: Date.now() };
        saveCache(record);
        return { record, stale: false };
      }
      if (!response.ok) throw new PrefabLookupError("unavailable");
      const payload: unknown = await response.json();
      if (!isCatalog(payload)) throw new PrefabLookupError("unavailable");
      const record = { payload, etag: response.headers.get("ETag"), fetchedAt: Date.now() };
      saveCache(record);
      return { record, stale: false };
    } catch {
      if (cached) return { record: cached, stale: true };
      throw new PrefabLookupError("unavailable");
    }
  })();
  inflight = pending;
  try { return await pending; } finally { if (inflight === pending) inflight = null; }
}

export async function getPrefabInfo(value: string | number, options: { refresh?: boolean } = {}): Promise<PrefabInfo> {
  const id = normalizePrefabId(value);
  const { record, stale } = await loadCatalog(options.refresh === true);
  const prefab = record.payload.prefabs[id];
  if (!prefab || prefab.id !== Number(id)) throw new PrefabLookupError(stale ? "unavailable" : "not-found");
  // Even a cached/modified record must not manufacture a URL for an unlisted PNG.
  if (prefab.imageUrl != null && (!prefab.img || prefab.img !== `sprite/${id}.png` || !/^https?:\/\//.test(prefab.imageUrl) ||
      new URL(prefab.imageUrl).pathname.split("/").slice(-2).join("/") !== prefab.img)) {
    throw new PrefabLookupError("unavailable");
  }
  const categories = (prefab.categoryIds ?? []).map((category) => {
    const data = record.payload.categories[String(category)];
    return { id: category, names: data?.names ?? {} };
  });
  // Keep cached references private (WebMCP/tool callers may mutate the returned value).
  return structuredClone({ ...prefab, categories, source: record.payload.source ?? {}, stale });
}

export function clearPrefabCache(): void {
  memory = null;
  try { window.localStorage.removeItem(CACHE_KEY); } catch { /* Optional browser storage. */ }
}

export function defaultPrefabVariable(id: number): string {
  return `prefab_${normalizePrefabId(id)}`;
}

export function validPrefabVariable(value: string): boolean {
  return !!value.trim() && value.length <= 128 && !/[\x00-\x1f\x7f]/.test(value);
}
