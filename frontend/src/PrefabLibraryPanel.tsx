import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "./i18n";
import { getPrefabInfo, PrefabLookupError, type PrefabInfo } from "./prefabLibrary";
import { PrefabHistoryPanel } from "./PrefabHistoryPanel";
import "./prefabLookup.css";

export function PrefabLibraryPanel({ onAdd, onDrag }: {
  onAdd: (info: PrefabInfo) => void;
  onDrag: (event: React.DragEvent<HTMLButtonElement>, info: PrefabInfo) => void;
}) {
  const { t, lang } = useI18n();
  const inputId = useId();
  const sequence = useRef(0);
  const [query, setQuery] = useState("");
  const [info, setInfo] = useState<PrefabInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => () => { sequence.current++; }, []);
  const label = (names: Record<string, string>, fallback: string) => names[lang === "zh" ? "zh-CN" : "en-US"] || names["zh-CN"] || names["en-US"] || fallback;

  async function lookup(refresh = false) {
    const request = ++sequence.current;
    setLoading(true); setInfo(null); setError(""); setImageFailed(false);
    try {
      const result = await getPrefabInfo(query, { refresh });
      if (sequence.current === request) setInfo(result);
    } catch (failure) {
      if (sequence.current === request) setError(failure instanceof PrefabLookupError ? failure.kind : "unavailable");
    } finally {
      if (sequence.current === request) setLoading(false);
    }
  }
  const name = info ? label(info.names, `Prefab ${info.id}`) : "";
  return (
    <div className="prefab-library-panel">
      <p className="prefab-hint">{t("prefab.libraryHint")}</p>
      <form onSubmit={(event) => { event.preventDefault(); void lookup(); }}>
        <label className="field" htmlFor={inputId}>
          <span>{t("prefab.id")}</span>
          <input id={inputId} value={query} inputMode="numeric" placeholder="20001003" autoComplete="off" spellCheck={false}
            onChange={(event) => { sequence.current++; setQuery(event.target.value); setInfo(null); setError(""); setLoading(false); }} />
        </label>
        <div className="prefab-library-actions">
          <button className="btn btn-primary" type="submit" disabled={!query.trim() || loading}>{t(loading ? "prefab.loading" : "prefab.search")}</button>
          <button className="btn btn-ghost" type="button" disabled={!query.trim() || loading} onClick={() => void lookup(true)}>{t("library.refresh")}</button>
        </div>
      </form>
      <div role="status" aria-live="polite">
        {error ? <p className="prefab-error">{t(`prefab.error.${error}`)}</p> : null}
        {info?.stale ? <p className="prefab-hint">{t("prefab.stale")}</p> : null}
      </div>
      {info ? (
        <article className="prefab-library-result">
          <button className="prefab-preview" type="button" draggable={!!info.imageUrl && !imageFailed}
            disabled={!info.imageUrl || imageFailed} aria-label={t("prefab.add")}
            onClick={() => onAdd(info)} onDragStart={(event) => onDrag(event, info)}>
            {info.imageUrl && !imageFailed ? <img src={info.imageUrl} alt={name} draggable={false} onError={() => setImageFailed(true)} /> : <span>{t(imageFailed ? "prefab.imageFailed" : "prefab.noImage")}</span>}
          </button>
          <strong>{name}</strong>
          <code>{info.id}</code>
          <p className="prefab-hint">{info.categories.map((category) => label(category.names, String(category.id))).join(" · ") || t("prefab.uncategorized")}</p>
          <p className="prefab-hint">{info.width && info.height ? `${info.width} × ${info.height} px` : "—"}</p>
          <button className="btn btn-primary" type="button" disabled={!info.imageUrl || imageFailed} onClick={() => onAdd(info)}>{t("prefab.add")}</button>
        </article>
      ) : !loading && !error ? <p className="prefab-empty">{t("prefab.empty")}</p> : null}
      <PrefabHistoryPanel onAdd={onAdd} onDrag={onDrag} />
    </div>
  );
}
