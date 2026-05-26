import { useEffect, useState } from "react";
import { fetchAppConfig } from "@/api/client";
import type { Network } from "@/types/config";

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
  const [activeNetworks, setActiveNetworks] = useState<Network[]>([]);
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
        setActiveNetworks(data.networks.map((n) => n.network));
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

  return { activeNetworks, loading, error };
}
