import { METADATA_KEYS } from "@filoz/synapse-sdk";
import type { INetworkConfig } from "../config/types.js";

/** Slot index tag: slot 0 (the baseline set) carries no such key, slots 1..N-1 carry `String(i)`. */
export const DATA_SET_SLOT_METADATA_KEY = "dealbotDS";

/**
 * Base metadata on every dealbot-provisioned data set. Lives here rather than on `DealService`
 * so `SpCleanupService` can rebuild slot metadata without depending on the deal module.
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
 * Exact metadata equality, mirroring `metadataMatches` in `@filoz/synapse-core/warm-storage` —
 * the rule `createContext` resolves a slot with. An extra key means no match.
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
