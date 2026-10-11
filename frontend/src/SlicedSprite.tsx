import { useEffect, useId, useRef, useState } from "react";
import { imageUrl, type SpriteMeta } from "./imageLibrary";
import { rasterSliceRegions } from "./imageStretch";

const sourceImages = new Map<string, Promise<HTMLImageElement>>();

function loadSource(url: string): Promise<HTMLImageElement> {
  const cached = sourceImages.get(url);
  if (cached) return cached;
  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Sprite image could not be loaded"));
    image.src = url;
  }).catch((error: unknown) => {
    sourceImages.delete(url);
    throw error;
  });
  sourceImages.set(url, pending);
  if (sourceImages.size > 64) sourceImages.delete(sourceImages.keys().next().value!);
  return pending;
}

/** Compose integer-aligned slices before CSS scaling/rotation, so no independent clip edges remain. */
export function SlicedSprite({ assetId, metadata, width, height, tint, color }: {
  assetId: number; metadata: SpriteMeta; width: number; height: number; tint?: boolean; color: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const filterId = `sliced-tint-${useId().replace(/:/g, "")}`;
  const [failed, setFailed] = useState(false);
  const needsTint = Boolean(tint && color.toLowerCase() !== "#ffffff");
  const channels = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255);
  const url = imageUrl(assetId);
  useEffect(() => {
    let active = true;
    void loadSource(url).then((image) => {
      if (!active || !canvasRef.current) return;
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas rendering is unavailable");
      const source = image;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "low";
      for (const { source: crop, target } of rasterSliceRegions(metadata, canvas.width, canvas.height,
        image.naturalWidth, image.naturalHeight)) {
        context.drawImage(source, crop[0], crop[1], crop[2], crop[3], target[0], target[1], target[2], target[3]);
      }
      setFailed(false);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [url, metadata, width, height]);

  return <>
    <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}>
      <defs><filter id={filterId} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feComponentTransfer><feFuncR type="linear" slope={channels[0]} /><feFuncG type="linear" slope={channels[1]} /><feFuncB type="linear" slope={channels[2]} /></feComponentTransfer>
      </filter></defs>
    </svg>
    {failed ? <img className="asset-sprite" src={imageUrl(assetId)} alt="" draggable={false} /> : null}
    <canvas ref={canvasRef} className="asset-sprite" data-image-type="stretch" aria-hidden="true"
      width={Math.max(1, Math.round(width))} height={Math.max(1, Math.round(height))}
      style={{ display: failed ? "none" : undefined, filter: needsTint ? `url(#${filterId})` : undefined }} />
  </>;
}
