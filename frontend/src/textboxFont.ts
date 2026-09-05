const LOCAL_FACES = [
  "HYWenHei-85W",
  "汉仪文黑-85W",
  "HYWenHei 85W",
  "HYWenHei"
];

function fontFormat(url: string): string {
  const path = url.split("?")[0].toLowerCase();
  if (path.endsWith(".woff2")) return "woff2";
  if (path.endsWith(".woff")) return "woff";
  if (path.endsWith(".otf")) return "opentype";
  if (path.endsWith(".ttf") || path.endsWith(".ttc")) return "truetype";
  return "woff2";
}

function cssUrl(url: string): string {
  return JSON.stringify(url);
}

/** Load 汉仪文黑-85W from the OS first; optional remote URL never hits this app server. */
export function installTextBoxFont(): void {
  const remote = String(import.meta.env.VITE_HYWENHEI_FONT_URL ?? "").trim();
  const localSrc = LOCAL_FACES.map((name) => `local(${JSON.stringify(name)})`).join(", ");
  const src = remote
    ? `${localSrc}, url(${cssUrl(remote)}) format(${JSON.stringify(fontFormat(remote))})`
    : localSrc;

  const style = document.createElement("style");
  style.setAttribute("data-textbox-font", "HYWenHei-85W");
  style.textContent = `@font-face{font-family:"HYWenHei-85W";src:${src};font-weight:400 900;font-display:swap;}`;
  document.head.appendChild(style);
}
