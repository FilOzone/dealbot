/// <reference types="vite/client" />

declare module "*.module.css";

interface ImportMeta {
  readonly env: {
    readonly VITE_API_BASE_URL: string;
  };
}
