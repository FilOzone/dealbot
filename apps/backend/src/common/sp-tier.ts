import type { INetworkConfig } from "src/config/types.js";

/**
 * Returns whether a provider qualifies for full-rate testing.
 *
 * @see [Provider eligibility and testing tiers](../../../../docs/jobs.md#provider-eligibility-and-testing-tiers)
 */
export function isFullRateTier(
  cfg: Pick<INetworkConfig, "fullRateSpAddresses" | "fullRateSpIds">,
  address: string,
  isApproved: boolean,
  id?: bigint | null,
): boolean {
  if (isApproved) return true;
  if (cfg.fullRateSpAddresses.has(address.toLowerCase())) return true;
  if (id != null && cfg.fullRateSpIds.has(String(id))) return true;
  return false;
}
