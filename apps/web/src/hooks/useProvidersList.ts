import { fetchProvidersList } from "@/api/client";
import type { ProvidersListResponseWithoutMetrics } from "@/types/providers";
import { useEffect, useState } from "react";

interface UseProvidersListReturn {
  providers: ProvidersListResponseWithoutMetrics;
  loading: boolean;
  error: string | null;
}

export function useProvidersList(offset = 0, limit = 20): UseProvidersListReturn {
  const [providers, setProviders] = useState<ProvidersListResponseWithoutMetrics>({
    providers: [],
    count: 0,
    limit: 20,
    offset: 0,
    total: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadProviders = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchProvidersList({ offset, limit });

        if (isMounted) {
          setProviders(data);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Failed to fetch providers list");
          console.error("Error fetching providers list:", err);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadProviders();

    return () => {
      isMounted = false;
    };
  }, [offset, limit]);

  return { providers, loading, error };
}
