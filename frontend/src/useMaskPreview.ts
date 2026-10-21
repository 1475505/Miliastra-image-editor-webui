import { useEffect, useMemo, useState } from "react";
import { loadMaskAsset, subscribeMaskAssets, type MaskAsset } from "./maskAssets";
import { luaMaskOf, type LuaMask } from "./luaMask";
import { createMaskPreview, type PreviewGeometry } from "./maskPreview";
import { isBasicMask } from "./maskShapes";

export function useMaskPreview(element: PreviewGeometry, value?: LuaMask | null, guides = false) {
  const mask = luaMaskOf(value), active = mask.enabled || mask.enableSoftEdge;
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ id: number; asset?: MaskAsset; failed?: boolean } | null>(null);
  useEffect(() => {
    if (!active || isBasicMask(mask.imageId)) return;
    let current = true;
    const unsubscribe = subscribeMaskAssets((id, asset) => { if (current && id === mask.imageId) setLoaded({ id, asset }); });
    setLoaded(null);
    void loadMaskAsset(mask.imageId).then(asset => { if (current) setLoaded({ id: mask.imageId, asset }); })
      .catch(() => { if (current) setLoaded({ id: mask.imageId, failed: true }); });
    return () => { current = false; unsubscribe(); };
  }, [active, mask.imageId, revision]);
  const asset = loaded?.id === mask.imageId ? loaded.asset : undefined;
  const result = useMemo(() => {
    try { return { preview: createMaskPreview(element, mask, asset, guides), failed: false }; }
    catch { return { preview: null, failed: true }; }
  }, [element.width, element.height, element.rotation, element.rotationX, element.rotationY, element.type,
    element.textBox?.scaleX, element.textBox?.scaleY, mask.enabled, mask.enableSoftEdge, mask.imageId, mask.imageType,
    mask.width, mask.height, mask.offsetX, mask.offsetY, mask.reverseMaskArea, mask.softEdgeMode,
    mask.softEdgeWidthX, mask.softEdgeWidthY, mask.horizontalSoftRange, mask.verticalSoftRange, asset, guides]);
  const failed = active && (result.failed || Boolean(loaded?.id === mask.imageId && loaded.failed));
  const loading = active && !isBasicMask(mask.imageId) && !asset && !failed;
  return { ...result, failed, loading, metadata: asset?.metadata, retry: () => setRevision(n => n + 1) };
}
