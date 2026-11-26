/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'true' liga o modo demo (API simulada pelo MSW no navegador). */
  readonly VITE_DEMO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
