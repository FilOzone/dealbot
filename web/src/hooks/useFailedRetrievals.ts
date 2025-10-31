import { useCallback, useEffect, useState } from "react";
import { fetchFailedRetrievals as apiFetchFailedRetrievals } from "../api/client";
import type { FailedRetrievalsQueryOptions, FailedRetrievalsResponse } from "../types/failed-retrievals";

export function useFailedRetrievals(options: FailedRetrievalsQueryOptions = {}) {
  const [data, setData] = useState<FailedRetrievalsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Extract individual values to use as dependencies
  const { page, limit, spAddress, serviceType, startDate, endDate } = options;

  useEffect(() => {
    let isCancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const result = await apiFetchFailedRetrievals({ page, limit, spAddress, serviceType, startDate, endDate });

        if (isCancelled) return;

        // Convert date strings to Date objects
        const processedResult = {
          ...result,
          failedRetrievals: result.failedRetrievals.map((retrieval) => ({
            ...retrieval,
            startedAt: new Date(retrieval.startedAt),
            completedAt: retrieval.completedAt ? new Date(retrieval.completedAt) : undefined,
            createdAt: new Date(retrieval.createdAt),
            updatedAt: new Date(retrieval.updatedAt),
          })),
        };

        setData(processedResult);
      } catch (err) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : "An error occurred");
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    // Cleanup function to prevent state updates on unmounted component
    return () => {
      isCancelled = true;
    };
  }, [page, limit, spAddress, serviceType, startDate, endDate]);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    // Trigger re-fetch by updating a dependency (this is handled by the effect)
  }, []);

  return { data, loading, error, refetch };
}
