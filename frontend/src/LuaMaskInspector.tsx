import { useI18n } from "./i18n";
import { luaMaskActive, luaMaskOf, type LuaMask } from "./luaMask";
import { MaskImagePicker } from "./MaskImagePicker";
import { ImageTypeSelect, useSpriteMetadata } from "./ImageAssetControls";
import { loadSpriteMeta } from "./imageLibrary";
import { resolveOptionalImageType } from "./imageStretch";
import { useEffect, useRef, useState } from "react";

export function LuaMaskInspector({ mask, width, height, supportsFill = true, onChange, onPreview, showGuides, onShowGuides }: {
  mask?: LuaMask | null; width: number; height: number; supportsFill?: boolean;
  onChange: (mask: LuaMask) => void;
  onPreview: (mask: LuaMask | null) => void;
  showGuides: boolean; onShowGuides: (show: boolean) => void;
}) {
  const { t } = useI18n();
  const value = luaMaskOf(mask);
  const update = (patch: Partial<LuaMask>) => onChange({ ...value, ...patch });
  const metadata = useSpriteMetadata(value.imageId);
  const selection = useRef(0), currentValue = useRef(value);
  currentValue.current = value;
  const [selecting, setSelecting] = useState(false), [selectionFailed, setSelectionFailed] = useState(false);
  useEffect(() => () => { selection.current++; onPreview(null); }, [onPreview]);
  useEffect(() => { selection.current++; setSelecting(false); }, [mask]);
  async function selectImage(imageId: number) {
    const request = ++selection.current;
    setSelecting(true); setSelectionFailed(false);
    try {
      const meta = await loadSpriteMeta(imageId);
      if (request !== selection.current) return;
      onChange({ ...currentValue.current, imageId, imageType: resolveOptionalImageType(meta, currentValue.current.imageType) });
    } catch { if (request === selection.current) setSelectionFailed(true); }
    finally { if (request === selection.current) setSelecting(false); }
  }
  const [draftId, setDraftId] = useState(String(value.imageId));
  useEffect(() => setDraftId(String(value.imageId)), [value.imageId]);
  const id = Number(draftId), validId = draftId.trim() !== "" && Number.isInteger(id) && id > 0 && id <= 0x7fffffff;
  const commitId = () => { if (validId && id !== value.imageId) void selectImage(id); };
  const number = (key: "offsetX" | "offsetY" | "width" | "height" | "softEdgeWidthX" | "softEdgeWidthY" | "horizontalSoftRange" | "verticalSoftRange" | "fillAmount", label: string, limits?: { min?: number; max?: number; step?: number }) => (
    <label className="num-field"><span>{label}</span><input type="number" step={limits?.step ?? "any"}
      min={limits?.min ?? (key === "width" || key === "height" ? 0 : undefined)}
      max={limits?.max}
      value={value[key] ?? (key === "width" ? width : height)}
      onChange={e => { const n = e.target.valueAsNumber; if (Number.isFinite(n)) {
        let next = key === "width" || key === "height" ? Math.max(0, n) : n;
        if (limits?.min !== undefined) next = Math.max(limits.min, next);
        if (limits?.max !== undefined) next = Math.min(limits.max, next);
        update({ [key]: next });
      } }} /></label>
  );
  return <>
    <div className="tip-box">{t("luaMask.only")}</div>
    {!luaMaskActive(value) ? <p className="field-hint">{t("luaMask.disabledHint")}</p> : null}
    {value.enableSoftEdge && value.softEdgeMode === "Pixel" && value.softEdgeWidthX === 0 && value.softEdgeWidthY === 0 ?
      <p className="field-hint">{t("luaMask.zeroFeather")}</p> : null}
    <div className="section-head"><span>{t("luaMask.mask")}</span></div>
    <label className="check-row"><input type="checkbox" checked={showGuides} onChange={e => onShowGuides(e.target.checked)} /><span>{t("luaMask.previewOnCanvas")}</span></label>
    <p className="field-hint">{t("luaMask.guidesHint")}</p>
    <label className="check-row"><input type="checkbox" checked={value.enabled} onChange={e => update({ enabled: e.target.checked })}/><span>{t("luaMask.enable")}</span></label>
    <MaskImagePicker value={value} width={width} height={height} onPreview={onPreview} showGuides={showGuides} onShowGuides={onShowGuides}
      onChange={patch => update(patch)} onSelectImage={imageId => void selectImage(imageId)} />
    <label className="field"><span>{t("luaMask.imageId")}</span>
      <input type="text" inputMode="numeric" value={draftId} aria-invalid={!validId}
        onChange={e => setDraftId(e.target.value)} onBlur={commitId}
        onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { selection.current++; setSelecting(false); setDraftId(String(value.imageId)); } }} />
      {!validId ? <em className="field-hint" role="status">{t("luaMask.invalidImageId")}</em> : null}
      <em className="field-hint">{t("luaMask.imageIdHint")}</em>
      {selecting || selectionFailed ? <small role="status">{t(selecting ? "library.metaLoading" : "library.metaFailed")}</small> : null}
    </label>
    <ImageTypeSelect label={t("luaMask.imageType")} value={value.imageType} metadata={metadata.meta} allowDefault
      loading={metadata.loading} error={metadata.error} onRetry={metadata.retry} onChange={imageType => update({ imageType })} />
    <p className="field-hint">{t("luaMask.imageTypeHint")}</p>
    <label className="check-row"><input type="checkbox" checked={value.reverseMaskArea} onChange={e => update({ reverseMaskArea: e.target.checked })}/><span>{t("luaMask.reverse")}</span></label>
    <label className="check-row"><input type="checkbox" checked={value.width === null && value.height === null}
      onChange={e => update(e.target.checked ? { width: null, height: null } : { width, height })}/><span>{t("luaMask.follow")}</span></label>
    <div className="grid-2">{number("offsetX", t("luaMask.offsetX"))}{number("offsetY", t("luaMask.offsetY"))}</div>
    <div className="grid-2">{number("width", t("props.width"))}{number("height", t("props.height"))}</div>
    <div className="section-head"><span>{t("luaMask.feather")}</span></div>
    <label className="check-row"><input type="checkbox" checked={value.enableSoftEdge} onChange={e => update({ enableSoftEdge: e.target.checked })}/><span>{t("luaMask.enableFeather")}</span></label>
    <label className="field"><span>{t("luaMask.mode")}</span><select value={value.softEdgeMode} onChange={e => update({ softEdgeMode: e.target.value as LuaMask["softEdgeMode"] })}>
      <option value="Pixel">{t("luaMask.pixel")}</option><option value="Percentage">{t("luaMask.percentage")}</option>
    </select></label>
    {value.softEdgeMode === "Pixel" ? <>
      <div className="grid-2">{number("softEdgeWidthX", `${t("luaMask.widthX")} (px)`)}{number("softEdgeWidthY", `${t("luaMask.widthY")} (px)`)}</div>
    </> : <>
      <div className="grid-2">{number("horizontalSoftRange", `${t("luaMask.rangeX")} (%)`)}{number("verticalSoftRange", `${t("luaMask.rangeY")} (%)`)}</div>
      <p className="field-hint">{t("luaMask.percentageHint")}</p>
    </>}
    <details className="lua-mask-native-values" key={value.softEdgeMode}>
      <summary>{t("luaMask.preservedValues")}</summary>
      <div className="grid-2">{value.softEdgeMode === "Pixel"
        ? <>{number("horizontalSoftRange", t("luaMask.rangeX"))}{number("verticalSoftRange", t("luaMask.rangeY"))}</>
        : <>{number("softEdgeWidthX", t("luaMask.widthX"))}{number("softEdgeWidthY", t("luaMask.widthY"))}</>}</div>
    </details>
    {supportsFill ? <>
      <div className="section-head"><span>{t("luaMask.fill")}</span></div>
      <label className="check-row"><input type="checkbox" checked={value.enableFill}
        onChange={e => update({ enableFill: e.target.checked, ...(e.target.checked && value.fillType === "unused" ? { fillType: "horizontal" as const } : {}) })}/><span>{t("luaMask.enableFill")}</span></label>
      {value.enableFill ? <>
        <label className="field"><span>{t("luaMask.fillType")}</span>
          <select value={value.fillType === "unused" ? "horizontal" : value.fillType}
            onChange={e => update({ fillType: e.target.value as LuaMask["fillType"] })}>
            <option value="horizontal">{t("luaMask.fillHorizontal")}</option>
            <option value="vertical">{t("luaMask.fillVertical")}</option>
            <option value="radial90">{t("luaMask.fillRadial90")}</option>
            <option value="radial180">{t("luaMask.fillRadial180")}</option>
            <option value="radial360">{t("luaMask.fillRadial360")}</option>
          </select></label>
        {value.fillType === "horizontal" ? <label className="field"><span>{t("luaMask.fillDirection")}</span>
          <select value={value.fillHorizontalType} onChange={e => update({ fillHorizontalType: e.target.value as LuaMask["fillHorizontalType"] })}>
            <option value="left">{t("luaMask.fillLeft")}</option><option value="right">{t("luaMask.fillRight")}</option>
          </select></label> : null}
        {value.fillType === "vertical" ? <label className="field"><span>{t("luaMask.fillDirection")}</span>
          <select value={value.fillVerticalType} onChange={e => update({ fillVerticalType: e.target.value as LuaMask["fillVerticalType"] })}>
            <option value="top">{t("luaMask.fillTop")}</option><option value="bottom">{t("luaMask.fillBottom")}</option>
          </select></label> : null}
        {value.fillType === "radial90" ? <label className="field"><span>{t("luaMask.fillStart")}</span>
          <select value={value.fillRadial90Type} onChange={e => update({ fillRadial90Type: e.target.value as LuaMask["fillRadial90Type"] })}>
            <option value="bottomLeft">{t("luaMask.fillBottomLeft")}</option><option value="topLeft">{t("luaMask.fillTopLeft")}</option>
            <option value="topRight">{t("luaMask.fillTopRight")}</option><option value="bottomRight">{t("luaMask.fillBottomRight")}</option>
          </select></label> : null}
        {value.fillType === "radial180" || value.fillType === "radial360" ? <label className="field"><span>{t("luaMask.fillStart")}</span>
          <select value={value.fillRadialType} onChange={e => update({ fillRadialType: e.target.value as LuaMask["fillRadialType"] })}>
            <option value="bottom">{t("luaMask.fillOriginBottom")}</option><option value="left">{t("luaMask.fillOriginLeft")}</option>
            <option value="top">{t("luaMask.fillOriginTop")}</option><option value="right">{t("luaMask.fillOriginRight")}</option>
          </select></label> : null}
        {number("fillAmount", t("luaMask.fillAmount"), { min: 0, max: 1, step: 0.01 })}
        <p className="field-hint">{t("luaMask.fillHint")}</p>
      </> : null}
    </> : null}
    <details className="lua-mask-native-values">
      <summary>{t("luaMask.notesSummary")}</summary>
      <p className="field-hint">{t("luaMask.previewHint")}</p>
      <p className="field-hint">{t("luaMask.rawHint")}</p>
      <p className="field-hint">{t("luaMask.mountHint")}</p>
    </details>
  </>;
}
