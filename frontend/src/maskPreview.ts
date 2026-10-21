import { luaMaskActive, luaMaskOf, type LuaMask } from "./luaMask";
import { rotationMatrix } from "./rotation";
import { drawBasicMask, isBasicMask } from "./maskShapes";
import { rasterSliceRegions, supportsImageStretch } from "./imageStretch";
import type { MaskAsset } from "./maskAssets";
import { alphaContourPath } from "./maskGuides";

export type MaskPreview = { image: string; width: number; height: number;
  guides?: { hiddenImage: string; path: string; pathWidth: number; pathHeight: number;
    x: number; y: number; width: number; height: number } };

export type PreviewGeometry = { width: number; height: number; rotation: number; rotationX?: number; rotationY?: number;
  type?: string; textBox?: { scaleX: number; scaleY: number } };

export function maskPreviewBounds(element: PreviewGeometry) {
  const { a, b, c, d } = rotationMatrix(element);
  const sx = element.type === "textbox" ? element.textBox?.scaleX ?? 1 : 1;
  const sy = element.type === "textbox" ? element.textBox?.scaleY ?? 1 : 1;
  // The preview buffer includes the projected visual, including scaled text.
  // Selection and transform handles stay on the original unmasked control.
  const width = Math.max(1, Math.ceil(Math.abs(a * element.width * sx) + Math.abs(c * element.height * sy)) + 4);
  const height = Math.max(1, Math.ceil(Math.abs(b * element.width * sx) + Math.abs(d * element.height * sy)) + 4);
  return { width, height, contentWidth: Math.abs(element.width * sx), contentHeight: Math.abs(element.height * sy) };
}

export function previewMaskSupported(mask?: Partial<LuaMask> | null, asset?: MaskAsset) {
  return luaMaskActive(mask) && (isBasicMask(mask?.imageId ?? 100001) || Boolean(asset));
}

/** Preview policy only: Percentage range is the full-opacity central span.
 * 85 means 85% opaque with a 7.5% linear fade at each edge. Range clipping is
 * preview-only; saved values and generated Lua remain unchanged.
 */
export function previewFeatherWidths(mask: LuaMask, width: number, height: number) {
  if (!mask.enableSoftEdge) return { x: 0, y: 0 };
  if (mask.softEdgeMode === "Percentage") {
    const edge = (size: number, range: number) => Math.max(0, size) * (1 - Math.max(0, Math.min(100, range)) / 100) / 2;
    return { x: edge(width, mask.horizontalSoftRange), y: edge(height, mask.verticalSoftRange) };
  }
  return { x: Math.max(0, mask.softEdgeWidthX), y: Math.max(0, mask.softEdgeWidthY) };
}

function coverage(x: number, y: number, mask: LuaMask, width: number, height: number, feather: { x: number; y: number }) {
  const dx = width / 2 - Math.abs(x - mask.offsetX);
  const dy = height / 2 - Math.abs(y - mask.offsetY);
  if (dx <= 0 || dy <= 0) return 0;
  return Math.min(1, feather.x > 0 ? dx / feather.x : 1, feather.y > 0 ? dy / feather.y : 1);
}

/** Linear inward fade: an editor approximation, not a measured native shader. */
export function previewCoverage(x: number, y: number, mask: LuaMask, width: number, height: number) {
  return coverage(x, y, mask, width, height, previewFeatherWidths(mask, width, height));
}

/** Inward contour feather: distances to transparent pixels along each enabled axis.
 * Two linear scans per axis keep this bounded for large local masks; holes count as edges.
 */
export function featherMaskAlpha(alpha: Uint8ClampedArray, width: number, height: number, featherX: number, featherY: number) {
  const result = new Float32Array(alpha.length);
  for (let i = 0; i < alpha.length; i++) result[i] = alpha[i] / 255;
  const scan = (horizontal: boolean, feather: number) => {
    if (!(feather > 0)) return;
    const length = horizontal ? width : height, lines = horizontal ? height : width;
    for (let line = 0; line < lines; line++) for (const direction of [1, -1]) {
      let distance = 0;
      for (let pos = direction > 0 ? 0 : length - 1; pos >= 0 && pos < length; pos += direction) {
        const i = horizontal ? line * width + pos : pos * width + line;
        distance = alpha[i] === 0 ? 0 : distance + 1;
        result[i] = Math.min(result[i], Math.max(0, distance - .5) / feather);
      }
    }
  };
  scan(true, featherX); scan(false, featherY);
  return Uint8ClampedArray.from(result, value => Math.round(value * 255));
}

function contourCanvas(mask: LuaMask, width: number, height: number, feather: { x: number; y: number }, asset?: MaskAsset, guides = false) {
  const ratio = Math.min(2, 1536 / Math.max(width, height));
  const w = Math.max(1, Math.ceil(width * ratio)), h = Math.max(1, Math.ceil(height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w + 2; canvas.height = h + 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.translate(1, 1);
  if (isBasicMask(mask.imageId)) drawBasicMask(ctx, mask.imageId, w, h);
  else if (asset) {
    const { image, metadata } = asset;
    const stretch = mask.imageType !== "basic" && supportsImageStretch(metadata);
    if (stretch && metadata) {
      // Scale metadata into this bounded raster so borders retain scene-unit thickness.
      const scaled = { ...metadata, width: metadata.width * w / width, height: metadata.height * h / height,
        border: { left: metadata.border.left * w / width, right: metadata.border.right * w / width,
          top: metadata.border.top * h / height, bottom: metadata.border.bottom * h / height } };
      for (const { source: [sx, sy, sw, sh], target: [x, y, tw, th] } of rasterSliceRegions(scaled, w, h, image.naturalWidth, image.naturalHeight)) {
        ctx.drawImage(image, sx, sy, sw, sh, x, y, tw, th);
      }
    } else ctx.drawImage(image, 0, 0, w, h);
  }
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let outline;
  if (guides && !isBasicMask(mask.imageId)) {
    const scale = Math.min(1, 256 / Math.max(w, h));
    const preview = document.createElement("canvas");
    preview.width = Math.max(1, Math.ceil(w * scale)); preview.height = Math.max(1, Math.ceil(h * scale));
    const context = preview.getContext("2d");
    if (context) {
      context.drawImage(canvas, 1, 1, w, h, 0, 0, preview.width, preview.height);
      const rgba = context.getImageData(0, 0, preview.width, preview.height).data;
      const alpha = new Uint8ClampedArray(preview.width * preview.height);
      for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
      outline = { path: alphaContourPath(alpha, preview.width, preview.height), width: preview.width, height: preview.height };
    }
  }
  const alpha = new Uint8ClampedArray(canvas.width * canvas.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = pixels.data[i * 4 + 3];
  const faded = featherMaskAlpha(alpha, canvas.width, canvas.height, feather.x * w / width, feather.y * h / height);
  for (let i = 0; i < faded.length; i++) {
    pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = 255;
    pixels.data[i * 4 + 3] = faded[i];
  }
  ctx.putImageData(pixels, 0, 0);
  return { canvas, width: w, height: h, outline };
}

export function createMaskPreview(element: PreviewGeometry, value?: LuaMask | null, asset?: MaskAsset, guides = false): MaskPreview | null {
  if (!previewMaskSupported(value, asset)) return null;
  const mask = luaMaskOf(value), bounds = maskPreviewBounds(element);
  if (![bounds.width, bounds.height, bounds.contentWidth, bounds.contentHeight].every(Number.isFinite)) return null;
  const width = mask.width ?? bounds.contentWidth, height = mask.height ?? bounds.contentHeight;
  const feather = previewFeatherWidths(mask, width, height);
  // One small mask per affected visual. Never allocate a full scene-sized buffer
  // for each element; the cap bounds imported oversized shapes as well.
  const ratio = Math.min(2, 2048 / Math.max(bounds.width, bounds.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(bounds.width * ratio));
  canvas.height = Math.max(1, Math.ceil(bounds.height * ratio));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  let outline: { path: string; width: number; height: number } | undefined;
  if (mask.imageId !== 100001 && width > 0 && height > 0) {
    const contour = contourCanvas(mask, width, height, feather, asset, guides);
    if (!contour) return null;
    outline = contour.outline;
    ctx.drawImage(contour.canvas, 1, 1, contour.width, contour.height,
      (bounds.width / 2 + mask.offsetX - width / 2) * canvas.width / bounds.width,
      (bounds.height / 2 + mask.offsetY - height / 2) * canvas.height / bounds.height,
      width * canvas.width / bounds.width, height * canvas.height / bounds.height);
  }
  const pixels = mask.imageId === 100001 ? ctx.createImageData(canvas.width, canvas.height) : ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let py = 0; py < canvas.height; py++) {
    const y = (py + .5) * bounds.height / canvas.height - bounds.height / 2;
    for (let px = 0; px < canvas.width; px++) {
      const x = (px + .5) * bounds.width / canvas.width - bounds.width / 2;
      const i = (py * canvas.width + px) * 4;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
      const alpha = mask.imageId === 100001 ? Math.round(255 * coverage(x, y, mask, width, height, feather)) : pixels.data[i + 3];
      pixels.data[i + 3] = mask.reverseMaskArea ? 255 - alpha : alpha;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  const result: MaskPreview = { image: `url("${canvas.toDataURL()}")`, width: bounds.width, height: bounds.height };
  if (guides) {
    // Auxiliary tint uses the exact complement, so feathering and reverse stay aligned.
    for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = 255 - pixels.data[i];
    ctx.putImageData(pixels, 0, 0);
    result.guides = { hiddenImage: `url("${canvas.toDataURL()}")`, path: outline?.path ?? "",
      pathWidth: outline?.width ?? 1, pathHeight: outline?.height ?? 1,
      x: mask.offsetX - width / 2, y: mask.offsetY - height / 2, width, height };
  }
  return result;
}
