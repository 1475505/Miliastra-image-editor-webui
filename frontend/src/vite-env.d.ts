/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HYWENHEI_FONT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
