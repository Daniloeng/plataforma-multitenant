/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'true' liga o modo demo (API simulada pelo MSW no navegador). */
  readonly VITE_DEMO?: string;
  /** URL do Keycloak (padrão http://localhost:8180); o realm é sempre "plataforma". */
  readonly VITE_KEYCLOAK_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
