import useSWR from "swr";
import { apiPaths, fetcher } from "@/api/client";
import type { ProvidersListResponseWithoutMetrics } from "@/types/providers";

interface UseProvidersListReturn {
  providers: ProvidersListResponseWithoutMetrics;
  loading: boolean;
  error: string | null;
}

const EMPTY_PROVIDERS: ProvidersListResponseWithoutMetrics = {
  providers: [],
  count: 0,
  limit: 20,
  offset: 0,
  total: 0,
};

export function useProvidersList(offset = 0, limit = 20): UseProvidersListReturn {
  const { data, error, isLoading } = useSWR<ProvidersListResponseWithoutMetrics>(
    apiPaths.providers({ offset, limit }),
    fetcher,
  );

  return {
    providers: data ?? EMPTY_PROVIDERS,
    loading: isLoading,
    error: toErrorMessage(error, "Failed to fetch providers list"),
  };
}

function toErrorMessage(error: unknown, fallback: string): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : fallback;
}
