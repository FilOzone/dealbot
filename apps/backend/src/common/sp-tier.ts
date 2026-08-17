import { INetworkConfig } from "src/config/types.js";

/**
 * Returns true if the provider qualifies for the full-rate testing tier:
 * already `isApproved` on-chain (approved SPs must stay fully monitored
 * regardless of manual-list staleness), or manually curated as an
 * expected-approval candidate. Every other SP (new, unknown, or not yet
 * vetted) defaults to the trickle tier — see #681.
 */
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
