import { useCallback, useEffect, useState } from "react";
import { fetchProviders } from "../api/client";
import type { ProviderCombinedPerformance, ProvidersQueryOptions } from "../types/providers";

/**
 * Error message extractor
 */
const toMessage = (error: unknown): string => (error instanceof Error ? error.message : "Unknown error");

/**
 * Hook state interface
 */
interface UseProvidersState {
  providers: ProviderCombinedPerformance[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
}

/**
 * Hook return interface
 */
interface UseProvidersReturn extends UseProvidersState {
  refetch: () => Promise<void>;
  setOptions: (options: ProvidersQueryOptions) => void;
}

/**
 * Custom hook to fetch and manage providers list
 *
 * @param initialOptions - Initial query options for filtering and pagination
 * @returns Providers data, loading state, error state, and control functions
 *
 * @example
 * ```tsx
 * const { providers, loading, error, refetch } = useProviders({
 *   limit: 20,
 *   activeOnly: true,
 *   sortBy: 'healthScore',
 *   sortOrder: 'desc'
 * });
 * ```
 */
export function useProviders(initialOptions?: ProvidersQueryOptions): UseProvidersReturn {
  const [options, setOptions] = useState<ProvidersQueryOptions>(initialOptions ?? {});
  const [state, setState] = useState<UseProvidersState>({
    providers: [],
    total: 0,
    page: 1,
    limit: 20,
    hasMore: false,
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      const response = await fetchProviders(options);

      setState({
        providers: response.providers,
        total: response.total,
        page: Math.floor(response.offset / response.limit) + 1,
        limit: response.limit,
        hasMore: response.count < response.total,
        loading: false,
        error: null,
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: toMessage(error),
      }));
    }
  }, [options]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    ...state,
    refetch: load,
    setOptions,
  };
}
