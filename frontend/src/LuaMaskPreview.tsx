import { type CSSProperties, type ReactNode } from "react";
import type { SceneElement } from "./App";
import { useMaskPreview } from "./useMaskPreview";
import { useI18n } from "./i18n";
import { rotationCss } from "./rotation";
import { MASK_POLYGONS } from "./maskShapes";
import type { MaskPreview } from "./maskPreview";
import { luaMaskOf } from "./luaMask";

export function LuaMaskPreview({ element, appearance, children, guides = false, zoom = 1 }: {
  element: SceneElement; appearance: CSSProperties; children: ReactNode;
  guides?: boolean;
  zoom?: number;
}) {
  const mask = element.luaMask;
  const { preview, loading, failed } = useMaskPreview(element, guides ? { ...luaMaskOf(mask), enabled: true } : mask, guides);
  const { t } = useI18n();
  const visual = <div className="shape-content" style={{ ...appearance, position: "absolute", left: "50%", top: "50%",
    width: element.width, height: element.height, transform: `translate(-50%, -50%) ${rotationCss(element)}`,
    pointerEvents: "none", zIndex: 0 }}>{children}</div>;
  if (!preview) return <>{visual}{loading || failed ? <span className="mask-preview-status" role="status">{t(loading ? "luaMask.loadingPreview" : "luaMask.failedPreview")}</span> : null}</>;
  if (guides && preview.guides) return <div className="lua-mask-guides" style={{ position: "absolute", left: "50%", top: "50%",
    width: preview.width, height: preview.height, transform: "translate(-50%, -50%)", pointerEvents: "none" }}>
    {visual}
    <div className="mask-hidden-overlay" aria-hidden="true" style={{
      maskImage: preview.guides.hiddenImage, WebkitMaskImage: preview.guides.hiddenImage,
      maskSize: "100% 100%", WebkitMaskSize: "100% 100%", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat", maskMode: "alpha"
    }} />
    <MaskOutline preview={preview} imageId={mask?.imageId ?? 100001} zoom={zoom} />
  </div>;
  return <div className="lua-mask-preview" data-mask-preview={mask?.enableSoftEdge && mask.softEdgeMode === "Percentage" ? "percentage" : "pixel"} style={{
    position: "absolute", left: "50%", top: "50%", width: preview.width, height: preview.height,
    transform: "translate(-50%, -50%)", pointerEvents: "none",
    maskImage: preview.image, WebkitMaskImage: preview.image,
    maskSize: "100% 100%", WebkitMaskSize: "100% 100%",
    maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat", maskMode: "alpha"
  }}>{visual}</div>;
}

function MaskOutline({ preview, imageId, zoom }: { preview: MaskPreview; imageId: number; zoom: number }) {
  const frame = preview.guides!;
  const { x, y, width, height } = frame;
  const shape = imageId === 100001 ? <rect x={x} y={y} width={width} height={height} /> :
    imageId === 100002 || imageId === 100006 ? <>
      <ellipse cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} />
      {imageId === 100006 ? <ellipse cx={x + width / 2} cy={y + height / 2} rx={width * .4} ry={height * .4} /> : null}
    </> : MASK_POLYGONS[imageId] ? <polygon points={MASK_POLYGONS[imageId].map(([px, py]) => `${x + px * width},${y + py * height}`).join(" ")} /> :
      <path d={frame.path} transform={`translate(${x} ${y}) scale(${width / frame.pathWidth} ${height / frame.pathHeight})`} />;
  // CSS canvas zoom sits outside the SVG viewport; non-scaling-stroke alone does
  // not compensate it. Set actual screen-pixel line widths through this factor.
  return <svg className="mask-guide-outline" viewBox={`${-preview.width / 2} ${-preview.height / 2} ${preview.width} ${preview.height}`} aria-hidden="true"
    style={{ "--mask-stroke": `${1 / zoom}px`, "--mask-dash": `${4 / zoom}px ${4 / zoom}px` } as CSSProperties}>
    <g className="mask-outline-dark">{shape}</g><g className="mask-outline-light">{shape}</g>
  </svg>;
}
