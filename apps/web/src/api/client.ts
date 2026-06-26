import type { Network } from "@/types/config";
import type { PaginationOptions } from "@/types/pagination";

type PaginationOptionsWithNetwork = PaginationOptions & {
  network?: Network | null;
};

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
// SWR FETCHER + KEYS
// ============================================================================

/**
 * Generic JSON fetcher for SWR.
 */
export async function fetcher<T>(path: string): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, { headers: JSON_HEADERS });
  if (!res.ok) throw new Error(`Request failed: ${path} (HTTP ${res.status})`);
  return (await res.json()) as T;
}

/**
 * Build `key` for SWR cache accepted by generic fetcher.
 */
export const apiPaths = {
  /** Dealbot app config (network this instance monitors, job rates, etc). */
  config: (): string => "/api/config",
  /** Simple providers list, for dropdowns/filters. */
  providers: (options?: PaginationOptionsWithNetwork): string | null => {
    if (!options?.network) {
      return null;
    }
    const queryString = buildQueryString(options as Record<string, string | number | boolean | undefined>);
    return `/api/v1/providers${queryString}`;
  },
} as const;
