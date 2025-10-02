import { useState, useEffect } from "react";
import type { FailedDealsResponseDto } from "../types/stats";

export interface UseFailedDealsParams {
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
  search?: string;
  provider?: string;
  withCDN?: boolean;
}

export function useFailedDeals(params: UseFailedDealsParams = {}) {
  const [data, setData] = useState<FailedDealsResponseDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFailedDeals = async () => {
    try {
      setLoading(true);
      setError(null);

      const queryParams = new URLSearchParams();
      if (params.startDate) queryParams.append("startDate", params.startDate);
      if (params.endDate) queryParams.append("endDate", params.endDate);
      if (params.page) queryParams.append("page", params.page.toString());
      if (params.limit) queryParams.append("limit", params.limit.toString());
      if (params.search) queryParams.append("search", params.search);
      if (params.provider) queryParams.append("provider", params.provider);
      if (params.withCDN !== undefined) queryParams.append("withCDN", params.withCDN.toString());

      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL ?? ""}/api/stats/failed-deals${queryParams.toString() ? "?" + queryParams.toString() : ""}`,
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
  }, [params.startDate, params.endDate, params.page, params.limit, params.search, params.provider, params.withCDN]);

  return { data, loading, error, refetch: fetchFailedDeals };
}
