import { useCallback, useEffect, useState } from "react";
import { fetchNetworkStats } from "../api/client";
import type { NetworkOverallStats } from "../types/network";

/**
 * Error message extractor
 */
const toMessage = (error: unknown): string => (error instanceof Error ? error.message : "Unknown error");

/**
 * Hook return interface
 */
interface UseNetworkStatsReturn {
  data: NetworkOverallStats | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Custom hook to fetch network-wide statistics
 *
 * Provides overall network metrics, health indicators, and activity trends
 * across all storage providers.
 *
 * @returns Network stats data, loading state, error state, and refetch function
 *
 * @example
 * ```tsx
 * const { data, loading, error, refetch } = useNetworkStats();
 *
 * if (loading) return <Skeleton />;
 * if (error) return <Error message={error} onRetry={refetch} />;
 * if (!data) return null;
 *
 * return (
 *   <>
 *     <NetworkOverview stats={data.overall} />
 *     <HealthIndicators health={data.health} />
 *     <TrendsChart trends={data.trends} />
 *   </>
 * );
 * ```
 */
export function useNetworkStats(): UseNetworkStatsReturn {
  const [data, setData] = useState<NetworkOverallStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetchNetworkStats();
      setData(response);
    } catch (err) {
      setError(toMessage(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    data,
    loading,
    error,
    refetch: load,
  };
}
