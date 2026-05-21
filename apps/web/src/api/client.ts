import type { AppConfigResponse } from "@/types/config";
import type { PaginationOptions } from "@/types/pagination";
import type { ProvidersListResponseWithoutMetrics } from "@/types/providers";

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

/**
 * Get the base API URL with fallback priority:
 * 1. Runtime value from window.__DEALBOT_CONFIG__.API_BASE_URL
 * 2. Build-time value from import.meta.env.VITE_API_BASE_URL (set via Docker ARG / Vite env)
 * 3. Empty string (uses relative URLs)
 */
const getBaseUrl = (): string => {
  const runtimeBaseUrl = typeof window === "undefined" ? undefined : window.__DEALBOT_CONFIG__?.API_BASE_URL;
  return runtimeBaseUrl ?? import.meta.env.VITE_API_BASE_URL ?? "";
};

/**
 * Build query string from params object
 */
const buildQueryString = (params: Record<string, string | number | boolean | undefined>): string => {
  const filtered = Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);

  return filtered.length > 0 ? `?${filtered.join("&")}` : "";
};

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Fetch simple providers list (without performance metrics)
 * Used for dropdowns and filters
 */
export async function fetchProvidersList(options?: PaginationOptions): Promise<ProvidersListResponseWithoutMetrics> {
  const queryString = options ? buildQueryString(options as Record<string, string | number | boolean | undefined>) : "";
  const url = `${getBaseUrl()}/api/v1/providers${queryString}`;

  const res = await fetch(url, { headers: JSON_HEADERS });
  if (!res.ok) throw new Error(`Failed to fetch providers list: HTTP ${res.status}`);

  return (await res.json()) as ProvidersListResponseWithoutMetrics;
}

/**
 * Fetch dealbot app configuration (networks this instance is monitoring, job rates, etc).
 */
export async function fetchAppConfig(signal?: AbortSignal): Promise<AppConfigResponse> {
  const url = `${getBaseUrl()}/api/config`;
  const res = await fetch(url, { headers: JSON_HEADERS, signal });
  if (!res.ok) throw new Error(`Failed to fetch app config: HTTP ${res.status}`);
  return (await res.json()) as AppConfigResponse;
}
