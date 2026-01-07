import { useCallback, useEffect, useState } from "react";
import { fetchProviderDailyMetrics } from "@/api/client";
import type { DailyMetricsQueryOptions, ProviderDailyMetricsResponse } from "@/types/metrics";

/**
 * Error message extractor
 */
const toMessage = (error: unknown): string => (error instanceof Error ? error.message : "Unknown error");

/**
 * Hook return interface
 */
interface UseProviderMetricsReturn {
  data: ProviderDailyMetricsResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  setOptions: (options: DailyMetricsQueryOptions) => void;
}

/**
 * Custom hook to fetch provider-specific daily metrics
 *
 * Fetches daily performance metrics for a specific storage provider
 * over a given date range.
 *
 * @param spAddress - Storage provider address
 * @param initialOptions - Initial query options for date range
 * @returns Provider daily metrics data, loading state, error state, and control functions
 *
 * @example
 * ```tsx
 * const { data, loading, error } = useProviderMetrics('f01234', {
 *   startDate: '2024-01-01',
 *   endDate: '2024-01-31'
 * });
 *
 * if (loading) return <Skeleton />;
 * if (error) return <Error message={error} />;
 * if (!data) return null;
 *
 * return (
 *   <>
 *     <ProviderHeader spAddress={data.spAddress} />
 *     <MetricsChart dailyMetrics={data.dailyMetrics} />
 *     <Summary summary={data.summary} />
 *   </>
 * );
 * ```
 */
export function useProviderMetrics(
  spAddress: string,
  initialOptions?: DailyMetricsQueryOptions,
): UseProviderMetricsReturn {
  const [options, setOptions] = useState<DailyMetricsQueryOptions>(initialOptions ?? {});
  const [data, setData] = useState<ProviderDailyMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!spAddress) {
      setError("Provider address is required");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetchProviderDailyMetrics(spAddress, options);
      setData(response);
    } catch (err) {
      setError(toMessage(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [spAddress, options]);

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
