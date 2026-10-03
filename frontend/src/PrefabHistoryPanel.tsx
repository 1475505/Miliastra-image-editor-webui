import { useEffect, useState } from "react";
import { useI18n } from "./i18n";
import { getPrefabInfo, type PrefabInfo } from "./prefabLibrary";
import { clearPrefabHistory, getPrefabHistory, removePrefabHistory, subscribePrefabHistory } from "./prefabHistory";

type Props = {
  onAdd: (info: PrefabInfo) => void;
  onDrag: (event: React.DragEvent<HTMLButtonElement>, info: PrefabInfo) => void;
};

export function PrefabHistoryPanel({ onAdd, onDrag }: Props) {
  const { t } = useI18n();
  const [entries, setEntries] = useState(getPrefabHistory);
  useEffect(() => {
    const update = () => setEntries(getPrefabHistory());
    const unsubscribe = subscribePrefabHistory(update);
    update();
    return unsubscribe;
  }, []);
  return <section className="prefab-history" aria-label={t("prefab.history.title")}>
    <div className="section-head">
      <span>{t("prefab.history.title")} <em>{entries.length}</em></span>
      {entries.length ? <button className="asset-retry" type="button" onClick={clearPrefabHistory}>{t("prefab.history.clear")}</button> : null}
    </div>
    {entries.length ? <div className="prefab-history-list">
      {entries.map((entry) => <HistoryItem key={entry.id} id={entry.id} onAdd={onAdd} onDrag={onDrag} />)}
    </div> : <p className="prefab-hint">{t("prefab.history.empty")}</p>}
  </section>;
}

function HistoryItem({ id, onAdd, onDrag }: Props & { id: number }) {
  const { t, lang } = useI18n();
  const [info, setInfo] = useState<PrefabInfo | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void getPrefabInfo(id).then((value) => { if (active) setInfo(value); }).catch(() => { /* No unlisted image requests. */ });
    return () => { active = false; };
  }, [id]);
  const name = info?.names[lang === "zh" ? "zh-CN" : "en-US"] || info?.names["zh-CN"] || info?.names["en-US"] || String(id);
  const usable = !!info?.imageUrl && !failed;
  return <div className="prefab-history-row" data-prefab-id={id}>
    <button type="button" className="prefab-history-item" disabled={!usable} draggable={usable}
      title={t("prefab.history.reuse", { name })} aria-label={t("prefab.history.reuse", { name })}
      onClick={() => { if (info) onAdd(info); }} onDragStart={(event) => { if (info) onDrag(event, info); }}>
      <div className="prefab-history-thumb">
        {usable ? <img src={info!.imageUrl!} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} /> : <span>—</span>}
      </div>
      <span className="prefab-history-label"><strong>{name}</strong><code>{id}</code></span>
    </button>
    <button type="button" className="icon-btn prefab-history-remove" aria-label={t("prefab.history.remove", { name })}
      title={t("prefab.history.remove", { name })} onClick={() => removePrefabHistory(id)}>×</button>
  </div>;
}
