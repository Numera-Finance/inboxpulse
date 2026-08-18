/// <reference types="wxt/vite-builder-env" />

interface ImportMetaEnv {
  /** Base URL of the CRM API (e.g. http://localhost:4001 or the Cloud Run API). */
  readonly WXT_API_URL?: string;
  /** Base URL of the CRM web app (e.g. http://localhost:4000 or the Cloud Run web app). */
  readonly WXT_WEB_URL?: string;
  /** 'true' restores the InboxSDK sidebar panel (parked by default — see lib/features.ts). */
  readonly WXT_ENABLE_SIDEBAR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
