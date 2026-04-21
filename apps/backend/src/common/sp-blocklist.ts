import type { ISpBlocklistConfig } from "../config/app.config.js";

/**
 * Returns true if the provider is in the SP blocklist.
 * Checks by address (case-insensitive) first, then by numeric ID if provided.
 */
export function isSpBlocked(cfg: ISpBlocklistConfig, address: string, id?: bigint | null): boolean {
  if (cfg.addresses.has(address.toLowerCase())) return true;
  if (id != null && cfg.ids.has(String(id))) return true;
  return false;
}
