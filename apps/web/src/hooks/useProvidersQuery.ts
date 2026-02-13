import { useQuery } from "@tanstack/react-query";
import { getBaseUrl } from "@/api/client";
import {
  type ProviderWindowMetricsResponse,
  providerWindowMetricsResponseSchema,
} from "@/schamas/providersWindowMetrics";

interface UseProvidersQueryOptions {
  startDate?: string;
  endDate?: string;
  preset?: string;
}

async function fetchProviders(options: UseProvidersQueryOptions): Promise<ProviderWindowMetricsResponse> {
  const params = new URLSearchParams();

  if (options.preset) {
    params.append("preset", options.preset);
  }

  if (options.startDate) {
    params.append("startDate", options.startDate);
  }

  if (options.endDate) {
    params.append("endDate", options.endDate);
  }

  const url = `${getBaseUrl()}/api/providers?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Failed to fetch providers");
  }

  const json: unknown = await response.json();
  return providerWindowMetricsResponseSchema.parse(json);
}

export function useProvidersQuery(options: UseProvidersQueryOptions = {}) {
  return useQuery({
    queryKey: ["providers", options],
    queryFn: () => fetchProviders(options),
  });
}
