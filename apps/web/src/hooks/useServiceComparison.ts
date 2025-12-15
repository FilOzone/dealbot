import { useCallback, useEffect, useState } from "react";
import { fetchServiceComparison } from "../api/client";
import type { ServiceComparisonQueryOptions, ServiceComparisonResponse } from "../types/services";

/**
 * Error message extractor
 */
const toMessage = (error: unknown): string => (error instanceof Error ? error.message : "Unknown error");

/**
 * Hook return interface
 */
interface UseServiceComparisonReturn {
  data: ServiceComparisonResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  setOptions: (options: ServiceComparisonQueryOptions) => void;
}

/**
 * Custom hook to fetch service type comparison metrics
 *
 * Compares retrieval performance across different service types:
 * - CDN (Content Delivery Network)
 * - DIRECT_SP (Direct Storage Provider)
 * - IPFS_PIN (IPFS Pinning Service)
 *
 * Perfect for visualizing service performance in bar charts and comparison dashboards.
 *
 * @param initialOptions - Initial query options for date range
 * @returns Service comparison data, loading state, error state, and control functions
 *
 * @example
 * ```tsx
 * const { data, loading, error } = useServiceComparison({
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
 *     <ServiceComparisonChart dailyMetrics={data.dailyMetrics} />
 *     <ServiceSummary summary={data.summary} />
 *   </>
 * );
 * ```
 */
export function useServiceComparison(initialOptions?: ServiceComparisonQueryOptions): UseServiceComparisonReturn {
  const [options, setOptions] = useState<ServiceComparisonQueryOptions>(initialOptions ?? {});
  const [data, setData] = useState<ServiceComparisonResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetchServiceComparison(options);
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
