/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIELDS_URL?: string;
  readonly VITE_BASEMAP_URL?: string;
  readonly VITE_CROPS_URL?: string;
  readonly VITE_FIELDS_SOURCE_LAYER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
