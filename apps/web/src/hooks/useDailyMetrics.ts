import { useCallback, useEffect, useState } from "react";
import { fetchDailyMetrics, fetchRecentDailyMetrics } from "../api/client";
import type { DailyMetricsQueryOptions, DailyMetricsResponse } from "../types/metrics";

/**
 * Error message extractor
 */
const toMessage = (error: unknown): string => (error instanceof Error ? error.message : "Unknown error");

/**
 * Hook return interface
 */
interface UseDailyMetricsReturn {
  data: DailyMetricsResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  setOptions: (options: DailyMetricsQueryOptions | number) => void;
}

/**
 * Custom hook to fetch daily aggregated metrics
 *
 * Supports two modes:
 * 1. Date range mode: Provide startDate and endDate
 * 2. Recent days mode: Provide number of days (shorthand)
 *
 * @param initialOptions - Initial query options (date range or number of days)
 * @returns Daily metrics data, loading state, error state, and control functions
 *
 * @example
 * ```tsx
 * // Fetch last 30 days
 * const { data, loading } = useDailyMetrics(30);
 *
 * // Fetch specific date range
 * const { data, loading } = useDailyMetrics({
 *   startDate: '2024-01-01',
 *   endDate: '2024-01-31'
 * });
 *
 * // Update date range dynamically
 * const { data, setOptions } = useDailyMetrics(7);
 * setOptions({ startDate: '2024-02-01', endDate: '2024-02-28' });
 * ```
 */
export function useDailyMetrics(initialOptions: DailyMetricsQueryOptions | number = 30): UseDailyMetricsReturn {
  const [options, setOptions] = useState<DailyMetricsQueryOptions | number>(initialOptions);
  const [data, setData] = useState<DailyMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      let response: DailyMetricsResponse;

      // If options is a number, use the recent days endpoint
      if (typeof options === "number") {
        response = await fetchRecentDailyMetrics(options);
      } else {
        // Otherwise use the date range endpoint
        response = await fetchDailyMetrics(options);
      }

      setData(response);
    } catch (err) {
      setError(toMessage(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [options]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    data,
    loading,
    error,
    refetch: load,
    setOptions,
  };
}
