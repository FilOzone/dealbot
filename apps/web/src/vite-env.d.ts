/// <reference types="vite/client" />

declare module "*.module.css";

interface ImportMeta {
  readonly env: {
    readonly VITE_API_BASE_URL: string;
    readonly VITE_PLAUSIBLE_DATA_DOMAIN?: string;
  };
}

interface Window {
  __DEALBOT_CONFIG__?: {
    API_BASE_URL?: string;
    PLAUSIBLE_DATA_DOMAIN?: string;
  };
}
