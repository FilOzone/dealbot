/**
 * Service layer for fetching provider versions
 * Handles API calls and data transformation
 */

import { fetchProviderCurioVersion, fetchProviderCurioVersionsBatch } from "@/api/client";
import { parseCurioVersion } from "@/utils/curioVersion";

/**
 * Fetch version directly from HTTPS provider
 * @param serviceUrl - Provider's HTTPS service URL
 * @returns Parsed version string
 */
export async function fetchDirectVersion(serviceUrl: string): Promise<string> {
  const rawVersion = await fetchProviderCurioVersion(serviceUrl);
  return parseCurioVersion(rawVersion);
}

/**
 * Fetch versions for multiple HTTP providers via backend batch endpoint
 * @param spAddresses - Array of storage provider addresses
 * @returns Map of provider address to parsed version string
 */
export async function fetchBatchVersions(spAddresses: string[]): Promise<Record<string, string>> {
  if (spAddresses.length === 0) {
    return {};
  }

  const rawVersions = await fetchProviderCurioVersionsBatch(spAddresses);

  // Parse all versions
  const parsedVersions: Record<string, string> = {};
  for (const [address, rawVersion] of Object.entries(rawVersions)) {
    parsedVersions[address] = parseCurioVersion(rawVersion);
  }

  return parsedVersions;
}
