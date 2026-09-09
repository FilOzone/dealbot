import { metadataMatches } from "@filoz/synapse-core/warm-storage";
import { describe, expect, it } from "vitest";
import type { INetworkConfig } from "../config/types.js";
import { getBaseDataSetMetadata, storedSlotMetadata } from "./data-set-slots.js";

const config = { dealbotDataSetVersion: undefined } as unknown as INetworkConfig;

describe("storedSlotMetadata", () => {
  /**
   * Pins the exact key set dealbot's data sets carry on-chain, read from mainnet: all 236 have
   * either `{source, withIPFSIndexing}` or those plus `dealbotDS`.
   *
   * This is the contract pruning depends on. `metadataMatches` requires an identical key
   * set, and pruning treats an unmatched data set as surplus — so a reconstruction missing a
   * single key matches nothing and would terminate the wallet's entire holding. `source` in
   * particular is added by the SDK (`combineMetadata`), never by our own callers, which is why
   * it is absent from `getBaseDataSetMetadata`.
   */
  it("reproduces the key set data sets actually carry on-chain", () => {
    expect(storedSlotMetadata(getBaseDataSetMetadata(config), 0)).toEqual({
      source: "dealbot",
      withIPFSIndexing: "",
    });
    expect(storedSlotMetadata(getBaseDataSetMetadata(config), 2)).toEqual({
      dealbotDS: "2",
      source: "dealbot",
      withIPFSIndexing: "",
    });
  });

  // Asserted through the SDK's own matcher, the one pruning uses, so this fails if the SDK
  // changes what it considers a match.
  it("matches a real on-chain metadata object through the SDK's matcher", () => {
    // Data set 729 on mainnet, verbatim.
    const onChain = { dealbotDS: "1", source: "dealbot", withIPFSIndexing: "" };
    expect(metadataMatches(onChain, storedSlotMetadata(getBaseDataSetMetadata(config), 1))).toBe(true);
    expect(metadataMatches(onChain, storedSlotMetadata(getBaseDataSetMetadata(config), 2))).toBe(false);
  });

  it("carries dealbotDataSetVersion when the network sets one", () => {
    const versioned = { dealbotDataSetVersion: "v2" } as unknown as INetworkConfig;
    expect(storedSlotMetadata(getBaseDataSetMetadata(versioned), 0)).toEqual({
      dealbotDataSetVersion: "v2",
      source: "dealbot",
      withIPFSIndexing: "",
    });
  });
});
