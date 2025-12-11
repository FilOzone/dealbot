import { useCallback, useEffect, useState } from "react";
import { fetchOverallStats } from "../api/client";
import type { OverallStatsResponseDto } from "../types/stats";

const toMessage = (e: unknown) => (e instanceof Error ? e.message : "Unknown error");

export function useOverallStats() {
  const [data, setData] = useState<OverallStatsResponseDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setData(await fetchOverallStats());
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, refetch: load };
}
