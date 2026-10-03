import { useEffect, useId, useState } from "react";
import { getPrefabInfo } from "./prefabLibrary";

/** Resolve every preview through the catalog, including imported/saved elements. */
export function PrefabSprite({ prefabId, color = "#ffffff" }: { prefabId: number; color?: string }) {
  const [image, setImage] = useState<{ id: number; url: string } | null>(null);
  const filterId = `prefab-tint-${useId().replace(/:/g, "")}`;
  useEffect(() => {
    let active = true;
    setImage(null);
    void getPrefabInfo(prefabId).then((info) => {
      if (active && info.imageUrl) setImage({ id: prefabId, url: info.imageUrl });
    }).catch(() => { /* Unknown IDs remain placeholders, with no PNG request. */ });
    return () => { active = false; };
  }, [prefabId]);
  if (!image || image.id !== prefabId) return <span className="prefab-placeholder">{prefabId}</span>;
  if (color.toLowerCase() !== "#ffffff") {
    const channels = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255);
    return <svg className="asset-sprite" width="100%" height="100%" aria-hidden="true">
      <defs><filter id={filterId} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feComponentTransfer><feFuncR type="linear" slope={channels[0]} /><feFuncG type="linear" slope={channels[1]} /><feFuncB type="linear" slope={channels[2]} /></feComponentTransfer>
      </filter></defs>
      <image href={image.url} width="100%" height="100%" preserveAspectRatio="none" filter={`url(#${filterId})`} />
    </svg>;
  }
  return <img className="asset-sprite" src={image.url} alt="" draggable={false} decoding="async" onError={() => setImage(null)} />;
}
