import { useI18n } from "./i18n";
import { luaMaskActive, luaMaskOf, type LuaMask } from "./luaMask";

export function LuaMaskInspector({ mask, width, height, onChange }: {
  mask?: LuaMask | null; width: number; height: number; onChange: (mask: LuaMask) => void;
}) {
  const { t } = useI18n();
  const value = luaMaskOf(mask);
  const update = (patch: Partial<LuaMask>) => onChange({ ...value, ...patch });
  const number = (key: "offsetX" | "offsetY" | "width" | "height" | "softEdgeWidthX" | "softEdgeWidthY" | "horizontalSoftRange" | "verticalSoftRange", label: string) => (
    <label className="num-field"><span>{label}</span><input type="number" step="any"
      min={key === "width" || key === "height" ? 0 : undefined}
      value={value[key] ?? (key === "width" ? width : height)}
      onChange={e => { const n = e.target.valueAsNumber; if (Number.isFinite(n)) update({ [key]: key === "width" || key === "height" ? Math.max(0, n) : n }); }} /></label>
  );
  return <>
    <div className="tip-box">{t("luaMask.only")}<br /><small>{t("luaMask.previewHint")}</small></div>
    {luaMaskActive(value) && value.reverseMaskArea ?
      <div className="tip-box" role="status">{t("luaMask.unverifiedPreview")}</div> : null}
    {luaMaskActive(value) && value.imageId !== 100001 ?
      <div className="tip-box" role="status">{t("luaMask.customImageHint")}</div> : null}
    {value.enableSoftEdge && value.softEdgeMode === "Pixel" && value.softEdgeWidthX === 0 && value.softEdgeWidthY === 0 ?
      <p className="field-hint">{t("luaMask.zeroFeather")}</p> : null}
    <div className="section-head"><span>{t("luaMask.mask")}</span></div>
    <label className="field"><span>{t("luaMask.imageId")}</span>
      <input type="number" min="1" max="2147483647" step="1" value={value.imageId}
        onChange={e => { const id = e.target.valueAsNumber; if (Number.isInteger(id) && id > 0 && id <= 0x7fffffff) update({ imageId: id }); }} />
      <em className="field-hint">{t("luaMask.imageIdHint")}</em>
    </label>
    <label className="field"><span>{t("luaMask.imageType")}</span>
      <select value={value.imageType ?? ""} onChange={e => update({ imageType: (e.target.value || null) as LuaMask["imageType"] })}>
        <option value="">{t("luaMask.imageTypeDefault")}</option>
        <option value="basic">{t("props.imageBasic")}</option>
        <option value="stretch">{t("props.imageStretch")}</option>
      </select>
      <em className="field-hint">{t("luaMask.imageTypeHint")}</em>
    </label>
    <label className="check-row"><input type="checkbox" checked={value.enabled} onChange={e => update({ enabled: e.target.checked })}/><span>{t("luaMask.enable")}</span></label>
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
    <p className="field-hint">{t("luaMask.rawHint")}</p>
    <p className="field-hint">{t("luaMask.mountHint")}</p>
  </>;
}
