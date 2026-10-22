import { useEffect, useRef } from "react";
import { useI18n } from "./i18n";

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const ref=useRef<HTMLDialogElement>(null), {t}=useI18n();
  useEffect(()=>{const dialog=ref.current;const focus=document.activeElement;dialog?.showModal();return()=>{dialog?.close();if(focus instanceof HTMLElement&&focus.isConnected)focus.focus();};},[]);
  const entries=[
    ["Shift + Click / Ctrl/⌘ + Click","selection.shortcut.toggle"],
    ["Shift + Click","selection.shortcut.range"],
    ["Drag / Shift + Drag","selection.shortcut.marquee"],
    ["Ctrl/⌘ + A","selection.shortcut.all"],
    ["Ctrl/⌘ + C / X / V","selection.shortcut.clipboard"],
    ["Ctrl/⌘ + D / Alt + Drag","selection.shortcut.duplicate"],
    ["Delete / Backspace","selection.shortcut.delete"],
    ["↑ ↓ ← → / Shift","selection.shortcut.nudge"],
    ["Ctrl/⌘ + [ / ]","selection.shortcut.layer"],
    ["Ctrl/⌘ + Shift + [ / ]","selection.shortcut.extreme"],
    ["Space + Drag / Middle drag","selection.shortcut.pan"],
    ["Ctrl/⌘ + 0 / 1 / + / −","selection.shortcut.zoom"],
    ["Escape","selection.shortcut.escape"],
    ["Ctrl/⌘ + Z / Shift + Z / Y","selection.shortcut.undo"],
    ["Ctrl/⌘ + S","selection.shortcut.save"]
  ];
  return <dialog ref={ref} className="shortcut-dialog" aria-labelledby="shortcut-title" onCancel={e=>{e.preventDefault();onClose();}}>
    <div className="mask-picker-heading"><h2 id="shortcut-title">{t("selection.shortcuts")}</h2><button className="icon-btn" onClick={onClose} aria-label={t("luaMask.close")}>×</button></div>
    <dl>{entries.map(([key,label])=><div key={label}><dt><kbd>{key}</kbd></dt><dd>{t(label)}</dd></div>)}</dl>
    <p className="field-hint">{t("selection.shortcutHint")}</p>
  </dialog>;
}
