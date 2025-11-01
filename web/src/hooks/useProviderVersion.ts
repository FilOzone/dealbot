import { useCallback, useEffect, useState } from "react";
import { fetchDirectVersion } from "@/services/versionService";
import { getFetchStrategy } from "@/utils/protocolDetection";

export interface IUseProviderVersion {
  serviceUrl: string;
  spAddress: string;
  batchedVersion?: string;
}

const toMessage = (e: unknown) => (e instanceof Error ? e.message : "Unknown error");

/**
 * Smart version fetching hook for individual providers
 *
 * Strategy:
 * - HTTP providers: Use pre-fetched batchedVersion
 * - HTTPS providers: Direct fetch (CSP-allowed, no proxy needed)
 */
export function useProviderVersion({ serviceUrl, spAddress, batchedVersion }: IUseProviderVersion) {
  const [version, setVersion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!serviceUrl || !spAddress) {
      setVersion("");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const strategy = getFetchStrategy(serviceUrl);

      switch (strategy) {
        case "batch":
          setVersion(batchedVersion || "");
          break;

        case "direct": {
          const directVersion = await fetchDirectVersion(serviceUrl);
          setVersion(directVersion);
          break;
        }

        case "none":
        default:
          setVersion("");
          break;
      }
    } catch (e) {
      setError(toMessage(e));
      setVersion("");
    } finally {
      setLoading(false);
    }
  }, [serviceUrl, spAddress, batchedVersion]);

  useEffect(() => {
    void load();
  }, [load]);

  return { version, loading, error, refetch: load };
}
