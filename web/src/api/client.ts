import type { DealbotConfigDto } from "../types/config";
import type { FailedDealsQueryOptions, FailedDealsResponse } from "../types/failed-deals";
import type { FailedRetrievalsQueryOptions, FailedRetrievalsResponse } from "../types/failed-retrievals";
import type { DailyMetricsQueryOptions, DailyMetricsResponse, ProviderDailyMetricsResponse } from "../types/metrics";
import type { NetworkOverallStats } from "../types/network";
import type {
  ProviderCombinedPerformance,
  ProvidersListResponse,
  ProvidersQueryOptions,
  ProviderWindowPerformanceDto,
  ProviderWindowQueryOptions,
} from "../types/providers";
import type { ServiceComparisonQueryOptions, ServiceComparisonResponse } from "../types/services";
import type { DailyMetricsResponseDto, OverallStatsResponseDto } from "../types/stats";
import type { VersionInfo } from "../types/version";

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

/**
 * Get the base API URL from environment or default to empty string
 */
const getBaseUrl = (): string => import.meta.env.VITE_API_BASE_URL ?? "";

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
// NEW API FUNCTIONS (Refactored Endpoints)
// ============================================================================

/**
 * Fetch all providers with their performance metrics
 * @param options - Query options for filtering and pagination
 */
export async function fetchProviders(options?: ProvidersQueryOptions): Promise<ProvidersListResponse> {
  const queryString = options ? buildQueryString(options as Record<string, string | number | boolean | undefined>) : "";
  const url = `${getBaseUrl()}/api/v1/providers/metrics${queryString}`;

  const res = await fetch(url, { headers: JSON_HEADERS });
  if (!res.ok) throw new Error(`Failed to fetch providers: HTTP ${res.status}`);

  return (await res.json()) as ProvidersListResponse;
}

/**
 * Fetch a single provider's performance metrics
 * @param spAddress - Storage provider address
 */
export async function fetchProvider(spAddress: string): Promise<ProviderCombinedPerformance> {
  const url = `${getBaseUrl()}/api/v1/providers/${encodeURIComponent(spAddress)}`;

  const res = await fetch(url, { headers: JSON_HEADERS });
  if (!res.ok) throw new Error(`Failed to fetch provider ${spAddress}: HTTP ${res.status}`);

  return (await res.json()) as ProviderCombinedPerformance;
}

/**
 * Fetch network-wide statistics
 */
export async function fetchNetworkStats(): Promise<NetworkOverallStats> {
  const url = `${getBaseUrl()}/api/v1/metrics/network/stats?approvedOnly=true&activeOnly=true`;

  const res = await fetch(url, { headers: JSON_HEADERS });
  if (!res.ok) throw new Error(`Failed to fetch network stats: HTTP ${res.status}`);

  return (await res.json()) as NetworkOverallStats;
}

/**
 * Fetch daily aggregated metrics
 * @param options - Query options for date range
 */
export async function fetchDailyMetrics(options?: DailyMetricsQueryOptions): Promise<DailyMetricsResponse> {
  const queryString = options ? buildQueryString(options as Record<string, string | number | boolean | undefined>) : "";
  const url = `${getBaseUrl()}/api/v1/metrics/daily${queryString}`;

  const res = await fetch(url, { headers: JSON_HEADERS });
  if (!res.ok) throw new Error(`Failed to fetch daily metrics: HTTP ${res.status}`);

  return (await res.json()) as DailyMetricsResponse;
}

/**
 * Fetch recent daily metrics (shorthand for last N days)
 * @param days - Number of days to fetch (default: 30)
 */
export async function fetchRecentDailyMetrics(days: number = 30): Promise<DailyMetricsResponse> {
  const url = `${getBaseUrl()}/api/v1/metrics/daily/recent?days=${days}`;

  const res = await fetch(url, { headers: JSON_HEADERS });
  if (!res.ok) throw new Error(`Failed to fetch recent daily metrics: HTTP ${res.status}`);

  return (await res.json()) as DailyMetricsResponse;
}

/**
 * Fetch provider-specific daily metrics
 * @param spAddress - Storage provider address
 * @param options - Query options for date range
 */
export async function fetchProviderDailyMetrics(
  spAddress: string,
  options?: DailyMetricsQueryOptions,
): Promise<ProviderDailyMetricsResponse> {
  const queryString = options ? buildQueryString(options as Record<string, string | number | boolean | undefined>) : "";
  const url = `${getBaseUrl()}/api/v1/metrics/daily/providers/${encodeURIComponent(spAddress)}${queryString}`;

  const res = await fetch(url, { headers: JSON_HEADERS });
  if (!res.ok) throw new Error(`Failed to fetch provider daily metrics: HTTP ${res.status}`);

  return (await res.json()) as ProviderDailyMetricsResponse;
}

/**
 * Fetch service type comparison metrics (CDN vs Direct SP vs IPFS Pin)
 * @param options - Query options for date range
 */
export async function fetchServiceComparison(
  options?: ServiceComparisonQueryOptions,
): Promise<ServiceComparisonResponse> {
  const queryString = options ? buildQueryString(options as Record<string, string | number | boolean | undefined>) : "";
  const url = `${getBaseUrl()}/api/v1/metrics/daily/service-comparison${queryString}`;

  const res = await fetch(url, { headers: JSON_HEADERS });
  if (!res.ok) throw new Error(`Failed to fetch service comparison: HTTP ${res.status}`);

  return (await res.json()) as ServiceComparisonResponse;
}

/**
 * Fetch provider-specific window metrics
 * @param spAddress - Storage provider address
 * @param options - Query options for window metrics
 */
export async function fetchProviderWindowMetrics(
  spAddress: string,
  options?: ProviderWindowQueryOptions,
): Promise<ProviderWindowPerformanceDto> {
  const queryString = options ? buildQueryString(options as Record<string, string | undefined>) : "";
  const url = `${getBaseUrl()}/api/v1/providers/metrics/${encodeURIComponent(spAddress)}/window${queryString}`;

  const res = await fetch(url, { headers: JSON_HEADERS });
  if (!res.ok) throw new Error(`Failed to fetch provider window metrics: HTTP ${res.status}`);

  return (await res.json()) as ProviderWindowPerformanceDto;
}

// ============================================================================
// FUNCTIONS to get SP Curio version
// ============================================================================
export async function fetchProviderCurioVersion(serviceUrl: string): Promise<string> {
  const res = await fetch(`${serviceUrl}/version`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.text()) as string;
}

export async function fetchProviderCurioVersionsBatch(spAddresses: string[]): Promise<Record<string, string>> {
  const res = await fetch(`${getBaseUrl()}/api/v1/providers/versions/batch`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ addresses: spAddresses }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Record<string, string>;
}

// ============================================================================
// OLD API FUNCTIONS (Deprecated - Keep for backward compatibility)
// ============================================================================

/**
 * @deprecated Use fetchNetworkStats() instead
 * Fetch overall stats from backend.
 */
export async function fetchOverallStats(): Promise<OverallStatsResponseDto> {
  const res = await fetch(`${getBaseUrl()}/api/stats/overall`, { headers: JSON_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as OverallStatsResponseDto;
}

/**
 * @deprecated Use fetchDailyMetrics() or fetchRecentDailyMetrics() instead
 * Fetch daily metrics from backend (last 30 days if available).
 */
export async function fetchDailyStats(): Promise<DailyMetricsResponseDto> {
  const res = await fetch(`${getBaseUrl()}/api/stats/daily`, { headers: JSON_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as DailyMetricsResponseDto;
}

/**
 * Fetch dealbot configuration from backend.
 */
export async function fetchDealbotConfig(): Promise<DealbotConfigDto> {
  const res = await fetch(`${getBaseUrl()}/api/config`, { headers: JSON_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as DealbotConfigDto;
}

/**
 * Fetch version information from backend.
 */
export async function fetchVersion(): Promise<VersionInfo> {
  const res = await fetch(`${getBaseUrl()}/api/version`, { headers: JSON_HEADERS });
  if (!res.ok) throw new Error(`Failed to fetch version: HTTP ${res.status}`);
  return (await res.json()) as VersionInfo;
}

/**
 * Fetch failed deals with pagination and filtering
 * @param options - Query options for filtering and pagination
 */
export async function fetchFailedDeals(options?: FailedDealsQueryOptions): Promise<FailedDealsResponse> {
  const queryString = options ? buildQueryString(options as Record<string, string | number | boolean | undefined>) : "";
  const url = `${getBaseUrl()}/api/v1/metrics/failed-deals${queryString}`;

  const res = await fetch(url, { headers: JSON_HEADERS });
  if (!res.ok) throw new Error(`Failed to fetch failed deals: HTTP ${res.status}`);

  return (await res.json()) as FailedDealsResponse;
}

/**
 * Fetch failed retrievals with pagination and filtering
 * @param options - Query options for filtering and pagination
 */
export async function fetchFailedRetrievals(options?: FailedRetrievalsQueryOptions): Promise<FailedRetrievalsResponse> {
  const queryString = options ? buildQueryString(options as Record<string, string | number | boolean | undefined>) : "";
  const url = `${getBaseUrl()}/api/v1/metrics/failed-retrievals${queryString}`;

  const res = await fetch(url, { headers: JSON_HEADERS });
  if (!res.ok) throw new Error(`Failed to fetch failed retrievals: HTTP ${res.status}`);

  return (await res.json()) as FailedRetrievalsResponse;
}
