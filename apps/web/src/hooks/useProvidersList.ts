import useSWR from "swr";
import { apiPaths, fetcher } from "@/api/client";
import type { ProvidersListResponseWithoutMetrics } from "@/types/providers";

interface UseProvidersListReturn {
  providers: ProvidersListResponseWithoutMetrics;
  loading: boolean;
  error: string | null;
}

export function useProvidersList(offset = 0, limit = 20): UseProvidersListReturn {
  const { data, error, isLoading } = useSWR(
    apiPaths.providers({ offset, limit }),
    fetcher<ProvidersListResponseWithoutMetrics>,
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
