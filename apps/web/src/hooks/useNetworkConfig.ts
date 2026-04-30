import { useEffect, useState } from "react";
import { fetchAppConfig } from "@/api/client";
import type { Network } from "@/types/config";

interface UseNetworkConfigReturn {
  network: Network | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetch the dealbot app config and expose the network this instance monitors.
 */
export function useNetworkConfig(): UseNetworkConfigReturn {
  const [network, setNetwork] = useState<Network | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchAppConfig(controller.signal);
        if (controller.signal.aborted) return;
        setNetwork(data.network);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to fetch app config");
        console.error("Error fetching app config:", err);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, []);

  return {
    network,
    loading,
    error,
  };
}
