/// <reference types="vite/client" />

declare module "*.module.css";

interface ImportMeta {
  readonly env: {
    readonly VITE_API_BASE_URL: string;
    readonly VITE_PLAUSIBLE_DATA_DOMAIN?: string;
    readonly VITE_DASHBOARD_URL?: string;
    readonly VITE_DASHBOARD_EMBED_URL?: string;
    readonly VITE_APPROVED_SP_DASHBOARD_URL?: string;
    readonly VITE_APPROVED_SP_DASHBOARD_URL_MAINNET?: string;
    readonly VITE_APPROVED_SP_DASHBOARD_URL_CALIBRATION?: string;
    readonly VITE_LOGS_URL?: string;
  };
}

interface Window {
  __DEALBOT_CONFIG__?: {
    API_BASE_URL?: string;
    PLAUSIBLE_DATA_DOMAIN?: string;
    DASHBOARD_URL?: string;
    DASHBOARD_EMBED_URL?: string;
    APPROVED_SP_DASHBOARD_URL?: string;
    APPROVED_SP_DASHBOARD_URL_MAINNET?: string;
    APPROVED_SP_DASHBOARD_URL_CALIBRATION?: string;
    LOGS_URL?: string;
  };
}
