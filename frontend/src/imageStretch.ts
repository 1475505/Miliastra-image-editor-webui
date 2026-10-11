import type { SpriteMeta } from "./imageLibrary";

export type ImageType = "basic" | "stretch";
export type SliceRegion = { source: number[]; target: number[] };

export function supportsImageStretch(meta: SpriteMeta | null | undefined): boolean {
  return Boolean(meta?.border && Object.values(meta.border).some((value) => Number.isFinite(value) && value > 0));
}

/** Undefined metadata is still loading; a missing file or zero borders only permits Basic. */
export function resolveImageType(meta: SpriteMeta | null | undefined, requested?: ImageType): ImageType | undefined {
  if (meta === undefined) return requested;
  return supportsImageStretch(meta) ? requested ?? "stretch" : "basic";
}

export function normalizeImageElement<T extends { type: string; imageAssetId?: number; imageType?: ImageType }>(
  element: T, meta: SpriteMeta | null | undefined
): T {
  if (element.type !== "image") return element;
  const imageType = resolveImageType(meta, element.imageType);
  return imageType === element.imageType ? element : { ...element, imageType };
}

/** Sprite borders use scene units directly; small controls shrink both borders proportionally. */
function axis(size: number, before: number, after: number, target: number) {
  before = Number.isFinite(before) ? Math.max(0, before) : 0;
  after = Number.isFinite(after) ? Math.max(0, after) : 0;
  const sourceScale = Math.min(1, size / (before + after || 1));
  before *= sourceScale;
  after *= sourceScale;
  const targetScale = Math.min(1, target / (before + after || 1));
  return { source: [0, before, size - after, size], target: [0, before * targetScale, target - after * targetScale, target] };
}

export function sliceRegions(meta: SpriteMeta, width: number, height: number): SliceRegion[] {
  if (!(meta.width > 0 && meta.height > 0 && width > 0 && height > 0)) return [];
  const x = axis(meta.width, meta.border.left, meta.border.right, width);
  const y = axis(meta.height, meta.border.top, meta.border.bottom, height);
  const regions: SliceRegion[] = [];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    const target = [x.target[col], y.target[row], x.target[col + 1] - x.target[col], y.target[row + 1] - y.target[row]];
    if (target[2] <= 0 || target[3] <= 0) continue;
    regions.push({ source: [x.source[col], y.source[row], x.source[col + 1] - x.source[col], y.source[row + 1] - y.source[row]], target });
  }
  return regions;
}
