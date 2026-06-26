import useSWR from "swr";
import { apiPaths, fetcher } from "@/api/client";
import type { Network } from "@/types/config";
import type { ProvidersListResponseWithoutMetrics } from "@/types/providers";

interface UseProvidersListReturn {
  providers: ProvidersListResponseWithoutMetrics;
  loading: boolean;
  error: string | null;
}

export function useProvidersList(offset = 0, limit = 20, network?: Network | null): UseProvidersListReturn {
  const { data, error, isLoading } = useSWR(
    apiPaths.providers({ offset, limit, network }),
    fetcher<ProvidersListResponseWithoutMetrics>,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      refreshInterval: 20 * 60 * 1000,
    },
  );

  const emptyProviders: ProvidersListResponseWithoutMetrics = {
    providers: [],
    count: 0,
    limit,
    offset,
    total: 0,
  };

  return {
    providers: data ?? emptyProviders,
    loading: isLoading,
    error: toErrorMessage(error, "Failed to fetch providers list"),
  };
}

function toErrorMessage(error: unknown, fallback: string): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : fallback;
}
