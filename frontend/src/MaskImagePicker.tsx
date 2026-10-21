import { useEffect, useId, useMemo, useRef, useState } from "react";
import { getCachedLibraryCatalog, loadLibraryCatalog, searchLibraryAssets, subscribeLibraryCatalog, type LibraryCatalogState } from "./imageLibrary";
import { useI18n } from "./i18n";
import { MASK_SHAPES } from "./maskShapes";
import { ImageTypeSelect, LibraryAssetThumbnail, useSpriteMetadata } from "./ImageAssetControls";
import { resolveImageType, resolveOptionalImageType } from "./imageStretch";
import { useMaskPreview } from "./useMaskPreview";
import type { LuaMask } from "./luaMask";

/** Independent coverage view: always shows the configured mask, even before enabling it. */
export function MaskCoveragePreview({ mask, width, height }: { mask: LuaMask; width: number; height: number }) {
  const { t } = useI18n();
  const mw = mask.width ?? width, mh = mask.height ?? height;
  const w = Math.max(1, width, mw + Math.abs(mask.offsetX) * 2) + 12;
  const h = Math.max(1, height, mh + Math.abs(mask.offsetY) * 2) + 12;
  const { preview, loading, failed, retry, metadata } = useMaskPreview(
    { width: w, height: h, rotation: 0 }, { ...mask, enabled: true, width: mw, height: mh });
  const source = preview?.image.slice(5, -2);
  return <div className="mask-coverage">
    <div className="mask-coverage-heading"><strong>{t("luaMask.coverageTitle")}</strong><span>{Math.round(mw)} × {Math.round(mh)}</span></div>
    <div className="mask-coverage-board" aria-label={t("luaMask.coverageTitle")}>
      {preview ? <svg viewBox={`0 0 ${preview.width} ${preview.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <image href={source} width={preview.width} height={preview.height} />
        <rect x={(preview.width - width) / 2} y={(preview.height - height) / 2} width={width} height={height}
          fill="none" stroke="#68c6b0" strokeWidth="1.5" strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />
      </svg> : <span role="status">{t(loading ? "luaMask.loadingPreview" : "luaMask.failedPreview")}</span>}
    </div>
    <small>{t("luaMask.coverageLegend")}</small>
    {failed ? <button className="btn btn-ghost" onClick={retry}>{t("luaMask.retry")}</button> : null}
    {metadata ? <small>{metadata.width} × {metadata.height} · {t(metadata.stretchable ? "luaMask.slicedAsset" : "luaMask.flatAsset")}</small> : null}
    {metadata && mask.imageType === null ? <small>{t("luaMask.defaultTypePreview")}</small> : null}
    {mask.imageId !== 100001 || mask.reverseMaskArea ? <small>{t("luaMask.contourPolicy")}</small> : null}
  </div>;
}

export function MaskImagePicker({ value, width, height, onChange, onSelectImage, onPreview, showGuides, onShowGuides }: {
  value: LuaMask; width: number; height: number; onChange: (patch: Partial<LuaMask>) => void;
  onSelectImage: (id: number) => void; onPreview: (mask: LuaMask | null) => void;
  showGuides: boolean; onShowGuides: (show: boolean) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const metadata = useSpriteMetadata(value.imageId);
  const imageType = resolveImageType(metadata.meta, value.imageType ?? undefined);
  const previewUrl = imageType === "stretch" ? getCachedLibraryCatalog()?.assets[value.imageId]?.stretchPreviewUrl : undefined;
  const shape = MASK_SHAPES.find(shape => shape.id === value.imageId);
  return <>
    <button type="button" className="mask-current-image" onClick={() => setOpen(true)}>
      <span className="mask-thumb"><LibraryAssetThumbnail assetId={value.imageId} previewUrl={previewUrl} /></span>
      <span><strong>{shape ? t(`shape.${shape.name}`) : t("luaMask.imageId")}</strong><code>{value.imageId}</code><small>{t("luaMask.chooseImage")}</small></span>
      <span aria-hidden="true">›</span>
    </button>
    <div className="mask-quick-shapes" aria-label={t("luaMask.quickShapes")}>
      {MASK_SHAPES.map(shape => <button key={shape.id} type="button" title={`${t(`shape.${shape.name}`)} · ${shape.id}`}
        aria-label={`${t(`shape.${shape.name}`)} ${shape.id}`} aria-pressed={value.imageId === shape.id} onClick={() => onSelectImage(shape.id)}>
        <span className="mask-thumb"><LibraryAssetThumbnail assetId={shape.id} /></span><small>{shape.id}</small>
      </button>)}
    </div>
    <MaskCoveragePreview mask={value} width={width} height={height} />
    {open ? <MaskPickerDialog key={JSON.stringify(value)} value={value} width={width} height={height} onClose={() => setOpen(false)} onPreview={onPreview}
      showGuides={showGuides} onShowGuides={onShowGuides}
      onApply={patch => { onChange(patch); setOpen(false); }} /> : null}
  </>;
}

function MaskPickerDialog({ value, width, height, onClose, onApply, onPreview, showGuides, onShowGuides }: {
  value: LuaMask; width: number; height: number; onClose: () => void; onApply: (patch: Partial<LuaMask>) => void;
  onPreview: (mask: LuaMask | null) => void;
  showGuides: boolean; onShowGuides: (show: boolean) => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null), titleId = useId();
  const [catalog, setCatalog] = useState<LibraryCatalogState | null>(getCachedLibraryCatalog);
  const [error, setError] = useState(false), [loading, setLoading] = useState(false);
  const [query, setQuery] = useState(""), [category, setCategory] = useState(""), [page, setPage] = useState(0);
  const [selected, setSelected] = useState(value.imageId);
  const [requestedType, setRequestedType] = useState(value.imageType);
  const [compact, setCompact] = useState(false);
  const metadata = useSpriteMetadata(selected);
  const imageType = resolveOptionalImageType(metadata.meta, requestedType);
  const initial = useRef(value);
  useEffect(() => {
    onPreview({ ...initial.current, enabled: true, imageId: selected, imageType });
    return () => onPreview(null);
  }, [selected, imageType, onPreview]);
  useEffect(() => {
    if (metadata.meta !== undefined && !metadata.error && requestedType !== imageType) setRequestedType(imageType);
  }, [metadata.meta, metadata.error, requestedType, imageType]);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); dialog?.querySelector<HTMLInputElement>('input[type="search"]')?.focus(); return () => dialog?.close(); }, []);
  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeLibraryCatalog(state => { if (active) setCatalog(state); });
    setLoading(true);
    void loadLibraryCatalog().then(state => { if (active) { setCatalog(state); setError(false); } })
      .catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; unsubscribe(); };
  }, []);
  const results = useMemo(() => catalog ? searchLibraryAssets(catalog, { query, category: category || undefined, offset: page * 36, limit: 36 }) : null,
    [catalog, query, category, page]);
  const selectedAsset = catalog?.assets[selected];
  return <dialog ref={ref} className={`mask-picker-dialog${compact ? " is-compact" : ""}`} aria-labelledby={titleId}
    onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => {
      if (e.target !== e.currentTarget) return;
      const r = e.currentTarget.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();
    }}>
    <div className="mask-picker-heading"><div><h2 id={titleId}>{t("luaMask.chooseImage")}</h2><p>{t("luaMask.pickerHint")}</p></div>
      <button className="icon-btn" onClick={onClose} aria-label={t("luaMask.close")}>×</button></div>
    <div className="mask-picker-preview-controls">
      <label className="check-row"><input type="checkbox" checked={showGuides} onChange={e => onShowGuides(e.target.checked)} /><span>{t("luaMask.previewOnCanvas")}</span></label>
      <button className="btn btn-ghost" onClick={() => setCompact(v => !v)}>{t(compact ? "luaMask.expandPicker" : "luaMask.viewCanvas")}</button>
    </div>
    <p className="field-hint">{t("luaMask.guidesHint")}</p>
    <div className="mask-picker-body" hidden={compact}><div className="mask-picker-library">
      <div className="mask-picker-filters">
        <input type="search" aria-label={t("luaMask.searchImages")} placeholder={t("luaMask.searchImages")} value={query}
          onChange={e => { setQuery(e.target.value); setPage(0); }} autoFocus />
        <select aria-label={t("luaMask.category")} value={category} onChange={e => { setCategory(e.target.value); setPage(0); }}>
          <option value="">{t("luaMask.allImages")}</option>
          {catalog?.groups.map(group => <option key={group.key} value={group.key}>{group.label}</option>)}
        </select>
      </div>
      <div className="mask-picker-grid">
        {results?.assets.map(asset => <button type="button" key={asset.id} className={selected === asset.id ? "is-selected" : ""}
          aria-label={`${asset.id} ${asset.description || asset.groupLabel}`} aria-pressed={selected === asset.id}
          title={asset.description || asset.groupLabel} onClick={() => setSelected(asset.id)}>
          <span className="mask-thumb"><LibraryAssetThumbnail assetId={asset.id} previewUrl={asset.stretchPreviewUrl} /></span><code>{asset.id}</code><small>{asset.description || asset.groupLabel}</small>
        </button>)}
        {!catalog ? MASK_SHAPES.map(shape => <button key={shape.id} aria-pressed={selected === shape.id} onClick={() => setSelected(shape.id)}>
          <span className="mask-thumb"><LibraryAssetThumbnail assetId={shape.id} /></span><code>{shape.id}</code><small>{t(`shape.${shape.name}`)}</small>
        </button>) : null}
      </div>
      {results?.matched === 0 ? <p role="status">{t("luaMask.noImages")}</p> : null}
      <div className="mask-picker-pagination">
        <button className="btn btn-ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)}>{t("luaMask.previous")}</button>
        <span role="status">{loading && !catalog ? t("luaMask.loadingImages") : error ? t("luaMask.catalogError") : `${results?.matched ?? 6} · ${page + 1} / ${Math.max(1, Math.ceil((results?.matched ?? 6) / 36))}`}</span>
        <button className="btn btn-ghost" disabled={results?.nextOffset == null} onClick={() => setPage(p => p + 1)}>{t("luaMask.next")}</button>
      </div>
    </div><aside className="mask-picker-detail">
      <strong>{selected}</strong><p>{selectedAsset?.description ?? t(`shape.${MASK_SHAPES.find(s => s.id === selected)?.name ?? "other"}`)}</p>
      <ImageTypeSelect label={t("luaMask.imageType")} value={imageType} metadata={metadata.meta} allowDefault
        loading={metadata.loading} error={metadata.error} onRetry={metadata.retry} onChange={setRequestedType} />
      <MaskCoveragePreview mask={{ ...value, imageId: selected, imageType }} width={width} height={height} />
    </aside></div>
    <div className="mask-picker-footer"><span>{t("luaMask.pickerSelectionHint")}</span>
      <button className="btn btn-ghost" onClick={onClose}>{t("luaMask.cancel")}</button>
      <button className="btn btn-primary" disabled={metadata.loading || metadata.error}
        onClick={() => onApply({ imageId: selected, imageType })}>{t("luaMask.applyImage")}</button>
    </div>
  </dialog>;
}
