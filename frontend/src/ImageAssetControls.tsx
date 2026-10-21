import { useEffect, useId, useState } from "react";
import { imageUrl, loadSpriteMeta, readMetaCache, type SpriteMeta } from "./imageLibrary";
import { supportsImageStretch, type ImageType } from "./imageStretch";
import { useI18n } from "./i18n";

/** Shared by the library, image inspector and mask picker. Never uses a guessed preview URL. */
export function LibraryAssetThumbnail({ assetId, previewUrl }: { assetId: number; previewUrl?: string }) {
  const [failed, setFailed] = useState<string[]>([]);
  const original = imageUrl(assetId);
  const source = previewUrl && !failed.includes(previewUrl) ? previewUrl : original;
  if (failed.includes(source)) return <span aria-hidden="true">?</span>;
  return <img src={source} alt="" loading="lazy" decoding="async" draggable={false}
    onError={() => setFailed(previous => previous.includes(source) ? previous : [...previous, source])} />;
}

export function useSpriteMetadata(assetId: number) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ id: number; meta?: SpriteMeta | null; error?: boolean }>(() => ({ id: assetId, meta: readMetaCache(assetId) }));
  useEffect(() => {
    let active = true;
    const cached = readMetaCache(assetId);
    setResult({ id: assetId, meta: cached });
    void loadSpriteMeta(assetId).then(meta => { if (active) setResult({ id: assetId, meta }); })
      .catch(() => { if (active) setResult({ id: assetId, error: true }); });
    return () => { active = false; };
  }, [assetId, revision]);
  const current = result.id === assetId ? result : { id: assetId, meta: readMetaCache(assetId) };
  return { ...current, loading: current.meta === undefined && !current.error, retry: () => setRevision(n => n + 1) };
}

export function ImageTypeSelect({ value, metadata, onChange, label, allowDefault = false, loading = false, error = false, onRetry }: {
  value: ImageType | null | undefined; metadata: SpriteMeta | null | undefined;
  onChange: (value: ImageType | null) => void; label?: string; allowDefault?: boolean;
  loading?: boolean; error?: boolean; onRetry?: () => void;
}) {
  const { t } = useI18n(), id = useId();
  const stretch = supportsImageStretch(metadata);
  return <div className="field">
    <label htmlFor={id}>{label ?? t("props.imageType")}</label>
    <select id={id} value={value ?? (allowDefault ? "" : "basic")} disabled={loading || error || (!allowDefault && !stretch)}
      onChange={e => onChange((e.target.value || null) as ImageType | null)}>
      {allowDefault ? <option value="">{t("luaMask.imageTypeDefault")}</option> : null}
      <option value="basic">{t("props.imageBasic")}</option>
      {stretch ? <option value="stretch">{t("props.imageStretch")}</option> : value === "stretch" ?
        <option value="stretch" disabled>{t("props.imageStretch")} · {t(loading ? "library.metaLoading" : "luaMask.unsupportedType")}</option> : null}
    </select>
    {loading ? <small>{t("library.metaLoading")}</small> : error ? <small role="status">{t("library.metaFailed")} <button type="button" className="asset-retry" onClick={onRetry}>{t("library.retry")}</button></small> :
      allowDefault ? <small>{t(stretch ? "luaMask.slicedAsset" : "luaMask.flatAsset")}</small> : null}
  </div>;
}
