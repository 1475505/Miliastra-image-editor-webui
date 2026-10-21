import { useMemo, type CSSProperties, type ReactNode } from "react";
import type { SceneElement } from "./App";
import { createMaskPreview } from "./maskPreview";
import { rotationCss } from "./rotation";

export function LuaMaskPreview({ element, appearance, children }: {
  element: SceneElement; appearance: CSSProperties; children: ReactNode;
}) {
  const mask = element.luaMask;
  const preview = useMemo(() => createMaskPreview(element, mask), [
    element.width, element.height, element.rotation, element.rotationX, element.rotationY,
    element.type, element.textBox?.scaleX, element.textBox?.scaleY,
    mask?.enabled, mask?.imageId, mask?.imageType, mask?.enableSoftEdge, mask?.softEdgeMode, mask?.reverseMaskArea,
    mask?.width, mask?.height, mask?.offsetX, mask?.offsetY, mask?.softEdgeWidthX, mask?.softEdgeWidthY,
    mask?.horizontalSoftRange, mask?.verticalSoftRange
  ]);
  const visual = <div className="shape-content" style={{ ...appearance, position: "absolute", left: "50%", top: "50%",
    width: element.width, height: element.height, transform: `translate(-50%, -50%) ${rotationCss(element)}`,
    pointerEvents: "none", zIndex: 0 }}>{children}</div>;
  if (!preview) return visual;
  return <div className="lua-mask-preview" data-mask-preview={mask?.enableSoftEdge && mask.softEdgeMode === "Percentage" ? "percentage" : "pixel"} style={{
    position: "absolute", left: "50%", top: "50%", width: preview.width, height: preview.height,
    transform: "translate(-50%, -50%)", pointerEvents: "none",
    maskImage: preview.image, WebkitMaskImage: preview.image,
    maskSize: "100% 100%", WebkitMaskSize: "100% 100%",
    maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat", maskMode: "alpha"
  }}>{visual}</div>;
}
