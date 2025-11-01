import { useCallback, useEffect, useState } from "react";
import { fetchProviderCurioVersion } from "@/api/client";
import { parseCurioVersion } from "@/utils/curioVersion";

export interface IUseProviderVersion {
  serviceUrl: string;
}
const toMessage = (e: unknown) => (e instanceof Error ? e.message : "Unknown error");

export function useProviderVersion({ serviceUrl }: IUseProviderVersion) {
  const [version, setVersion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!serviceUrl) {
      setVersion("");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setVersion(parseCurioVersion(await fetchProviderCurioVersion(serviceUrl)));
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setLoading(false);
    }
  }, [serviceUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  return { version, loading, error, refetch: load };
}
