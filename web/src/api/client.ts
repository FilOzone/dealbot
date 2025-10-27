import type { DealbotConfigDto } from "../types/config";
import type { DailyMetricsResponseDto, OverallStatsResponseDto } from "../types/stats";

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

/**
 * Fetch overall stats from backend.
 */
export async function fetchOverallStats() {
  const res = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}/api/stats/overall`, { headers: JSON_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as OverallStatsResponseDto;
}

/**
 * Fetch daily metrics from backend (last 30 days if available).
 */
export async function fetchDailyStats() {
  const res = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}/api/stats/daily`, { headers: JSON_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as DailyMetricsResponseDto;
}

/**
 * Fetch dealbot configuration from backend.
 */
export async function fetchDealbotConfig() {
  const res = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}/api/config`, { headers: JSON_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as DealbotConfigDto;
}
