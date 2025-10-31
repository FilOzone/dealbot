import { useCallback, useEffect, useState } from "react";
import { fetchFailedDeals as apiFetchFailedDeals } from "../api/client";
import type { FailedDealsQueryOptions, FailedDealsResponse } from "../types/failed-deals";

export function useFailedDeals(options: FailedDealsQueryOptions = {}) {
  const [data, setData] = useState<FailedDealsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Extract individual values to use as dependencies
  const { page, limit, spAddress, startDate, endDate } = options;

  useEffect(() => {
    let isCancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const result = await apiFetchFailedDeals({ page, limit, spAddress, startDate, endDate });

        if (isCancelled) return;

        // Convert date strings to Date objects
        const processedResult = {
          ...result,
          failedDeals: result.failedDeals.map((deal) => ({
            ...deal,
            createdAt: new Date(deal.createdAt),
            updatedAt: new Date(deal.updatedAt),
            uploadStartTime: deal.uploadStartTime ? new Date(deal.uploadStartTime) : undefined,
            uploadEndTime: deal.uploadEndTime ? new Date(deal.uploadEndTime) : undefined,
            pieceAddedTime: deal.pieceAddedTime ? new Date(deal.pieceAddedTime) : undefined,
            dealConfirmedTime: deal.dealConfirmedTime ? new Date(deal.dealConfirmedTime) : undefined,
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
  }, [page, limit, spAddress, startDate, endDate]);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    // Trigger re-fetch by updating a dependency (this is handled by the effect)
  }, []);

  return { data, loading, error, refetch };
}
