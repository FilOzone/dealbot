import { SUPPORTED_NETWORKS } from "./constants.js";
import type { Network } from "./types.js";

/**
 * Returns the normalized legacy network from
 * `DEALBOT_LEGACY_NETWORK_BACKFILL` (preferred) or `NETWORK`.
 * Used by the Postgres and ClickHouse migrations.
 */
export function resolveLegacyNetworkBackfill(requirement: string): Network {
  const backfillNetwork = (process.env.DEALBOT_LEGACY_NETWORK_BACKFILL ?? process.env.NETWORK ?? "")
    .trim()
    .toLowerCase();
  if (!SUPPORTED_NETWORKS.includes(backfillNetwork as Network)) {
    throw new Error(`${requirement} Got: "${backfillNetwork}". Allowed: ${SUPPORTED_NETWORKS.join(", ")}`);
  }
  return backfillNetwork as Network;
}
