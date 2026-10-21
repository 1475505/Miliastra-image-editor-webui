import { assetMaskUrl, loadSpriteMeta, type SpriteMeta } from "./imageLibrary";

export type MaskAsset = { image: HTMLImageElement; metadata: SpriteMeta | null };
const assets = new Map<number, Promise<MaskAsset>>();
const listeners = new Set<(id: number, asset: MaskAsset) => void>();

export function subscribeMaskAssets(listener: (id: number, asset: MaskAsset) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Same-origin pixels keep canvas export readable. Share requests, bound cache, retry failures. */
export function loadMaskAsset(id: number): Promise<MaskAsset> {
  const cached = assets.get(id);
  if (cached) return cached;
  const image = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    const timer = window.setTimeout(() => { img.src = ""; reject(new Error("Mask image timeout")); }, 15000);
    img.onload = () => { window.clearTimeout(timer); resolve(img); };
    img.onerror = () => { window.clearTimeout(timer); reject(new Error("Mask image unavailable")); };
    img.src = assetMaskUrl(id);
  });
  const request = Promise.all([image, loadSpriteMeta(id)]).then(([image, metadata]) => {
    const asset = { image, metadata };
    for (const listener of listeners) listener(id, asset);
    return asset;
  })
    .catch((error: unknown) => { if (assets.get(id) === request) assets.delete(id); throw error; });
  assets.set(id, request);
  if (assets.size > 32) assets.delete(assets.keys().next().value!);
  return request;
}
