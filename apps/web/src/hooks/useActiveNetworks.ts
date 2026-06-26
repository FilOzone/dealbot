import useSWR from "swr";
import { apiPaths, fetcher } from "@/api/client";
import type { AppConfigResponse, Network } from "@/types/config";

interface UseActiveNetworksReturn {
  activeNetworks: Network[];
  loading: boolean;
  error: string | null;
}

/**
 * Fetches the dealbot app config and returns the list of networks this
 * deployment is actively monitoring (e.g. ["calibration"] or ["calibration", "mainnet"]).
 */
export function useActiveNetworks(): UseActiveNetworksReturn {
  const { data, error, isLoading } = useSWR(apiPaths.config(), fetcher<AppConfigResponse>, {
    revalidateIfStale: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  return {
    activeNetworks: data?.networks.map((n) => n.network) ?? [],
    loading: isLoading,
    error: toErrorMessage(error, "Failed to fetch app config"),
  };
}

function toErrorMessage(error: unknown, fallback: string): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : fallback;
}
