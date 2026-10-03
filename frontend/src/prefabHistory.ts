import { getPrefabInfo, normalizePrefabId } from "./prefabLibrary";

export type PrefabHistoryEntry = { id: number; addedAt: number };
const STORAGE_KEY = "miliastra:prefab-history:v1";
let memory: PrefabHistoryEntry[] | null = null;
let actionTime = 0;
let generation = 0;
const removedAt = new Map<number, number>();
const listeners = new Set<() => void>();

function decode(value: unknown): PrefabHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<number, PrefabHistoryEntry>();
  for (const row of value) {
    if (!row || typeof row !== "object" || typeof row.id !== "number" || !Number.isFinite(row.addedAt)) continue;
    try { normalizePrefabId(row.id); } catch { continue; }
    if (row.addedAt < 0) continue;
    const previous = unique.get(row.id);
    if (!previous || previous.addedAt < row.addedAt) unique.set(row.id, { id: row.id, addedAt: row.addedAt });
  }
  return [...unique.values()].sort((a, b) => b.addedAt - a.addedAt);
}

export function getPrefabHistory(): PrefabHistoryEntry[] {
  if (memory === null) {
    try { memory = decode(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")); }
    catch { memory = []; }
  }
  return memory.map((row) => ({ ...row }));
}

function save(entries: PrefabHistoryEntry[]): void {
  memory = decode(entries);
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memory)); } catch { /* Keep session history usable. */ }
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  memory = null;
  for (const listener of listeners) listener();
}

export function subscribePrefabHistory(listener: () => void): () => void {
  if (!listeners.size) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", onStorage);
  };
}

/** Call after the canvas edit succeeds; never record failed/unknown additions. */
export async function recordAddedPrefabs(values: number[]): Promise<void> {
  const ids = [...new Set(values)];
  if (!ids.length) return;
  actionTime = Math.max(Date.now(), actionTime + 1);
  const timestamp = actionTime;
  const startedGeneration = generation;
  const infos = await Promise.all(ids.map((id) => getPrefabInfo(id).catch(() => null)));
  if (startedGeneration !== generation) return;
  const added = infos.flatMap((info) => info?.imageUrl && (removedAt.get(info.id) ?? -1) < timestamp ? [{ id: info.id, addedAt: timestamp }] : []);
  if (!added.length) return;
  const latest = new Map(getPrefabHistory().map((row) => [row.id, row]));
  for (const row of added) {
    const previous = latest.get(row.id);
    if (!previous || previous.addedAt <= row.addedAt) latest.set(row.id, row);
  }
  save([...latest.values()]);
}

export function removePrefabHistory(id: number): void {
  actionTime = Math.max(Date.now(), actionTime + 1);
  removedAt.set(id, actionTime);
  save(getPrefabHistory().filter((row) => row.id !== id));
}

export function clearPrefabHistory(): void {
  generation++;
  removedAt.clear();
  save([]);
}
