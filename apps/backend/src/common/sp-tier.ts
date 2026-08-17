import type { INetworkConfig } from "src/config/types.js";

/** Returns whether a provider qualifies for full-rate testing. */
export function isFullRateTier(
  cfg: Pick<INetworkConfig, "expectedApprovedSpAddresses" | "expectedApprovedSpIds">,
  address: string,
  isApproved: boolean,
  id?: bigint | null,
): boolean {
  if (isApproved) return true;
  if (cfg.expectedApprovedSpAddresses.has(address.toLowerCase())) return true;
  if (id != null && cfg.expectedApprovedSpIds.has(String(id))) return true;
  return false;
}
