import { useCallback, useEffect, useState } from "react";
import { fetchDealbotConfig } from "@/api/client";
import type { DealbotConfigDto } from "@/types/config";

export function useDealbotConfig() {
  const [data, setData] = useState<DealbotConfigDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        const result = await fetchDealbotConfig();

        if (isMounted) {
          setData(result);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Failed to load config");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, []);

  const refetch = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const result = await fetchDealbotConfig();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load config");
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, refetch };
}
