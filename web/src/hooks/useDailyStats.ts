import { useCallback, useEffect, useState } from "react";
import { fetchDailyStats } from "../api/client";
import type { DailyMetricsResponseDto } from "../types/stats";

const toMessage = (e: unknown) => (e instanceof Error ? e.message : "Unknown error");

export function useDailyStats() {
  const [data, setData] = useState<DailyMetricsResponseDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setData(await fetchDailyStats());
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
