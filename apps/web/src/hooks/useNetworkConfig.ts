import useSWR from "swr";
import { apiPaths, fetcher } from "@/api/client";
import type { AppConfigResponse, Network } from "@/types/config";

interface UseNetworkConfigReturn {
  network: Network | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetch the dealbot app config and expose the network this instance monitors.
 */
export function useNetworkConfig(): UseNetworkConfigReturn {
  const { data, error, isLoading } = useSWR<AppConfigResponse>(apiPaths.config(), fetcher);

  return {
    network: data?.network ?? null,
    loading: isLoading,
    error: toErrorMessage(error, "Failed to fetch app config"),
  };
}

function toErrorMessage(error: unknown, fallback: string): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : fallback;
}
