import { useState, useEffect } from "react";
import type { FailedDealsResponseDto } from "../types/stats";

export function useFailedDeals(startDate?: string, endDate?: string, limit?: number) {
  const [data, setData] = useState<FailedDealsResponseDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFailedDeals = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);
      if (limit) params.append("limit", limit.toString());

      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL ?? ""}/api/stats/failed-deals${params.toString() ? "?" + params.toString() : ""}`,
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch failed deals: ${response.statusText}`);
      }

      const result = await response.json();

      // Convert date strings to Date objects
      const processedResult = {
        ...result,
        failedDeals: result.failedDeals.map((deal: any) => ({
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
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFailedDeals();
  }, [startDate, endDate, limit]);

  return { data, loading, error, refetch: fetchFailedDeals };
}
