import { useCallback, useEffect, useState } from "react";
import { fetchProvider } from "@/api/client";
import type { ProviderCombinedPerformance } from "@/types/providers";

/**
 * Error message extractor
 */
const toMessage = (error: unknown): string => (error instanceof Error ? error.message : "Unknown error");

/**
 * Hook return interface
 */
interface UseProviderReturn {
  data: ProviderCombinedPerformance | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Custom hook to fetch a single provider's performance metrics
 *
 * @param spAddress - Storage provider address
 * @returns Provider data, loading state, error state, and refetch function
 *
 * @example
 * ```tsx
 * const { data, loading, error } = useProvider('f01234');
 *
 * if (loading) return <Skeleton />;
 * if (error) return <Error message={error} />;
 * if (!data) return null;
 *
 * return <ProviderDetail weekly={data.weekly} allTime={data.allTime} />;
 * ```
 */
export function useProvider(spAddress: string): UseProviderReturn {
  const [data, setData] = useState<ProviderCombinedPerformance | null>(null);
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

      const response = await fetchProvider(spAddress);
      setData(response);
    } catch (err) {
      setError(toMessage(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [spAddress]);

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
