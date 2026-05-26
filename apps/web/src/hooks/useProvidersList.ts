import { useEffect, useState } from "react";
import { fetchProvidersList } from "@/api/client";
import type { Network } from "@/types/config";
import type { ProvidersListResponseWithoutMetrics } from "@/types/providers";

interface UseProvidersListReturn {
  providers: ProvidersListResponseWithoutMetrics;
  loading: boolean;
  error: string | null;
}

const EMPTY_RESPONSE: ProvidersListResponseWithoutMetrics = {
  providers: [],
  count: 0,
  limit: 20,
  offset: 0,
  total: 0,
};

/**
 * Fetches a paginated providers list scoped to the given `network`.
 *
 * Pass `null` to suspend fetching (e.g. while the active-network config is
 * still loading) — the hook stays in loading state without issuing a request.
 * Pass `undefined` to fetch providers for all active networks (no filter).
 */
export function useProvidersList(
  offset = 0,
  limit = 20,
  network: Network | null | undefined = undefined,
): UseProvidersListReturn {
  const [providers, setProviders] = useState<ProvidersListResponseWithoutMetrics>(EMPTY_RESPONSE);
  // Start in loading state so callers always see a spinner before the first fetch resolves.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // null means "wait for the selected network to be determined" — skip the fetch entirely.
    if (network === null) return;

    let isMounted = true;

    const loadProviders = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchProvidersList({
          offset,
          limit,
          ...(network !== undefined ? { network } : {}),
        });
        if (isMounted) setProviders(data);
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Failed to fetch providers list");
          console.error("Error fetching providers list:", err);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadProviders();

    return () => {
      isMounted = false;
    };
  }, [offset, limit, network]);

  return { providers, loading, error };
}
