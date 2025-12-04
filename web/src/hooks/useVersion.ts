import { useEffect, useState } from "react";
import type { VersionInfo } from "../types/version";
import versionData from "../version.json";

/**
 * Hook to get version information
 * Returns version info from both build-time (version.json) and runtime (API)
 */
export function useVersion() {
  const [buildVersion] = useState<VersionInfo>(versionData as VersionInfo);
  const [apiVersion, setApiVersion] = useState<VersionInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchApiVersion = async () => {
      try {
        setLoading(true);
        const response = await fetch("/api/version");
        if (!response.ok) {
          throw new Error("Failed to fetch version info");
        }
        const data = await response.json();
        setApiVersion(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchApiVersion();
  }, []);

  // Use API version if available, otherwise fall back to build version
  const version = apiVersion || buildVersion;

  return { version, buildVersion, apiVersion, loading, error };
}
