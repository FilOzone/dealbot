import { useCallback, useEffect, useState } from "react";
import { fetchBatchVersions } from "@/services/versionService";
import type { ProviderCombinedPerformance } from "@/types/providers";
import { shouldFetchBatch } from "@/utils/protocolDetection";

/**
 * Batch fetch versions for all HTTP providers at once
 * Returns a map of spAddress -> parsed version
 */
export function useProviderVersionsBatch(providers: ProviderCombinedPerformance[]) {
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!providers || providers.length === 0) {
      setVersions({});
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const batchProviders = providers.filter((p) => shouldFetchBatch(p.provider.serviceUrl));

      if (batchProviders.length === 0) {
        setVersions({});
        return;
      }

      const addresses = batchProviders.map((p) => p.provider.address);
      const parsedVersions = await fetchBatchVersions(addresses);

      setVersions(parsedVersions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setVersions({});
    } finally {
      setLoading(false);
    }
  }, [providers]);

  useEffect(() => {
    void load();
  }, [load]);

  return { versions, loading, error, refetch: load };
}
