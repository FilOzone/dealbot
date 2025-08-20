import type { OverallStatsResponseDto } from "../types/stats";

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

/**
 * Fetch overall stats from backend.
 */
export async function fetchOverallStats() {
  const res = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}/api/stats/overall`, { headers: JSON_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as OverallStatsResponseDto;
}
