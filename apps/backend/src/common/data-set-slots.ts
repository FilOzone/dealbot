import { METADATA_KEYS } from "@filoz/synapse-sdk";
import type { INetworkConfig } from "../config/types.js";

/**
 * Metadata key that tags a data set with its provisioning slot index.
 * Slot 0 (the baseline set) carries no such key; slots 1..N-1 carry `dealbotDS: String(i)`.
 * See `provisionNextMissingDataSet` in jobs/data-set-creation.handler.ts.
 */
export const DATA_SET_SLOT_METADATA_KEY = "dealbotDS";

/**
 * Base metadata attached to every dealbot-provisioned data set on a network.
 *
 * Extracted here (rather than living only on `DealService`) so `SpCleanupService`
 * can reconstruct the exact slot metadata deal jobs provision against without
 * depending on the whole deal module.
 */
export function getBaseDataSetMetadata(networkConfig: INetworkConfig): Record<string, string> {
  // IPNI is always enabled for all deals
  const metadata: Record<string, string> = {
    [METADATA_KEYS.WITH_IPFS_INDEXING]: "",
  };
  if (networkConfig.dealbotDataSetVersion) {
    metadata.dealbotDataSetVersion = networkConfig.dealbotDataSetVersion;
  }
  return metadata;
}

/** Metadata for provisioning slot `index`: slot 0 is the baseline, slots 1+ add the index tag. */
export function slotMetadata(baseMetadata: Record<string, string>, index: number): Record<string, string> {
  return {
    ...baseMetadata,
    ...(index > 0 ? { [DATA_SET_SLOT_METADATA_KEY]: String(index) } : {}),
  };
}

/**
 * Exact metadata equality, mirroring `metadataMatches` in
 * `@filoz/synapse-core/warm-storage` — the rule `synapse.storage.createContext`
 * uses to resolve a slot to a data set. Same key count, same values; a set
 * carrying an extra key does *not* match. Keeping this identical to the SDK is
 * what lets pruning predict which set a deal job will pick.
 */
export function metadataMatchesExactly(
  dataSetMetadata: Record<string, string>,
  requestedMetadata: Record<string, string>,
): boolean {
  const requestedKeys = Object.keys(requestedMetadata);
  if (Object.keys(dataSetMetadata).length !== requestedKeys.length) {
    return false;
  }
  for (const key of requestedKeys) {
    if (dataSetMetadata[key] !== requestedMetadata[key]) {
      return false;
    }
  }
  return true;
}
