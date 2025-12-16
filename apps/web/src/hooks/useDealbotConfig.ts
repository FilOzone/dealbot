import { useCallback, useEffect, useState } from "react";
import { fetchDealbotConfig } from "../api/client";
import type { DealbotConfigDto } from "../types/config";

export function useDealbotConfig() {
  const [data, setData] = useState<DealbotConfigDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
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

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, refetch: load };
}
