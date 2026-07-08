import { INetworkConfig } from "src/config/types.js";

/**
 * Returns true if the provider is in the SP blocklist.
 * Checks by address (case-insensitive) first, then by numeric ID if provided.
 */
export function isSpBlocked(
  cfg: Pick<INetworkConfig, "blockedSpAddresses" | "blockedSpIds">,
  address: string,
  id?: bigint | null,
): boolean {
  if (cfg.blockedSpAddresses.has(address.toLowerCase())) return true;
  if (id != null && cfg.blockedSpIds.has(String(id))) return true;
  return false;
}
