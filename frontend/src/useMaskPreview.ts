import { useEffect, useMemo, useState } from "react";
import { loadMaskAsset, subscribeMaskAssets, type MaskAsset } from "./maskAssets";
import { luaMaskActive, luaMaskOf, type LuaMask } from "./luaMask";
import { createMaskPreview, type PreviewGeometry } from "./maskPreview";
import { isBasicMask } from "./maskShapes";

export function useMaskPreview(element: PreviewGeometry, value?: LuaMask | null, guides = false) {
  const mask = luaMaskOf(value), active = luaMaskActive(mask);
  // Progress fill alone does not read the mask image.
  const usesMaskImage = Boolean(mask.enabled || mask.enableSoftEdge) && !isBasicMask(mask.imageId);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ id: number; asset?: MaskAsset; failed?: boolean } | null>(null);
  useEffect(() => {
    if (!active || !usesMaskImage || isBasicMask(mask.imageId)) return;
    let current = true;
    const unsubscribe = subscribeMaskAssets((id, asset) => { if (current && id === mask.imageId) setLoaded({ id, asset }); });
    setLoaded(null);
    void loadMaskAsset(mask.imageId).then(asset => { if (current) setLoaded({ id: mask.imageId, asset }); })
      .catch(() => { if (current) setLoaded({ id: mask.imageId, failed: true }); });
    return () => { current = false; unsubscribe(); };
  }, [active, usesMaskImage, mask.imageId, revision]);
  const asset = loaded?.id === mask.imageId ? loaded.asset : undefined;
  const result = useMemo(() => {
    try { return { preview: createMaskPreview(element, mask, asset, guides), failed: false }; }
    catch { return { preview: null, failed: true }; }
  }, [element.width, element.height, element.rotation, element.rotationX, element.rotationY, element.type,
    element.textBox?.scaleX, element.textBox?.scaleY, mask.enabled, mask.enableSoftEdge, mask.imageId, mask.imageType,
    mask.width, mask.height, mask.offsetX, mask.offsetY, mask.reverseMaskArea, mask.softEdgeMode,
    mask.softEdgeWidthX, mask.softEdgeWidthY, mask.horizontalSoftRange, mask.verticalSoftRange,
    mask.enableFill, mask.fillType, mask.fillHorizontalType, mask.fillVerticalType,
    mask.fillRadial90Type, mask.fillRadialType, mask.fillAmount, asset, guides]);
  const failed = active && (result.failed || Boolean(loaded?.id === mask.imageId && loaded.failed));
  const loading = active && usesMaskImage && !asset && !failed;
  return { ...result, failed, loading, metadata: asset?.metadata, retry: () => setRevision(n => n + 1) };
}
