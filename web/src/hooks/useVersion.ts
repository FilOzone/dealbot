import { useEffect, useState } from "react";
import { fetchVersion } from "../api/client";
import type { VersionInfo } from "../types/version";

/**
 * Hook to get version information from API
 * Returns version info from the backend API endpoint
 */
export function useVersion() {
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchApiVersion = async () => {
      try {
        setLoading(true);
        const data = await fetchVersion();
        if (!cancelled) {
          setVersion(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchApiVersion();

    return () => {
      cancelled = true;
    };
  }, []);

  return { version, loading, error };
}
