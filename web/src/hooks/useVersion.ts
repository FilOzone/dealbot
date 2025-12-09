import { useEffect, useState } from "react";
import { fetchVersion } from "../api/client";
import type { VersionInfo } from "../types/version";
import versionData from "../version.json";

/**
 * Hook to get version information
 * Returns version info from both build-time (version.json) and runtime (API)
 */
export function useVersion() {
  const [buildVersion] = useState<VersionInfo>(versionData as VersionInfo);
  const [apiVersion, setApiVersion] = useState<VersionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchApiVersion = async () => {
      try {
        setLoading(true);
        const data = await fetchVersion();
        if (!cancelled) {
          setApiVersion(data);
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

  // Use API version if available, otherwise fall back to build version
  const version = apiVersion || buildVersion;

  return { version, buildVersion, apiVersion, loading, error };
}
