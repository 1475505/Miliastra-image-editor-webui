import { luaMaskActive, luaMaskOf, type LuaMask } from "./luaMask";
import { rotationMatrix } from "./rotation";

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

export function previewMaskSupported(mask?: Partial<LuaMask> | null) {
  return luaMaskActive(mask) && !mask?.reverseMaskArea && (mask?.imageId ?? 100001) === 100001;
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

export function createMaskPreview(element: PreviewGeometry, value?: LuaMask | null): { image: string; width: number; height: number } | null {
  if (!previewMaskSupported(value)) return null;
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
  const pixels = ctx.createImageData(canvas.width, canvas.height);
  for (let py = 0; py < canvas.height; py++) {
    const y = (py + .5) * bounds.height / canvas.height - bounds.height / 2;
    for (let px = 0; px < canvas.width; px++) {
      const x = (px + .5) * bounds.width / canvas.width - bounds.width / 2;
      const i = (py * canvas.width + px) * 4;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
      pixels.data[i + 3] = Math.round(255 * coverage(x, y, mask, width, height, feather));
    }
  }
  ctx.putImageData(pixels, 0, 0);
  return { image: `url("${canvas.toDataURL()}")`, width: bounds.width, height: bounds.height };
}
