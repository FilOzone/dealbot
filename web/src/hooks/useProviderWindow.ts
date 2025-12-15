import { useCallback, useEffect, useState } from "react";
import { fetchProviderWindowMetrics } from "@/api/client";
import type { ProviderWindowPerformanceDto } from "../types/providers";

interface UseProviderWindowOptions {
  spAddress: string;
  preset?: string;
  startDate?: string;
  endDate?: string;
  enabled?: boolean;
}

interface UseProviderWindowResult {
  data: ProviderWindowPerformanceDto | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useProviderWindow({
  spAddress,
  preset,
  startDate,
  endDate,
  enabled = true,
}: UseProviderWindowOptions): UseProviderWindowResult {
  const [data, setData] = useState<ProviderWindowPerformanceDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    if (!enabled || !spAddress) return;

    setLoading(true);
    setError(null);

    try {
      const result = await fetchProviderWindowMetrics(spAddress, {
        startDate,
        endDate,
        preset,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to fetch provider window data"));
    } finally {
      setLoading(false);
    }
  }, [spAddress, enabled, startDate, endDate, preset]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
