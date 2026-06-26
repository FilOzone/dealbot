import { describe, expect, it } from "vitest";
import {
  CHAIN_SPECIFIC_NETWORK_VARS,
  INHERITABLE_NETWORK_VARS,
  inheritsUnprefixed,
  PER_NETWORK_VARS,
} from "./network-fields.js";

describe("network-fields classification", () => {
  it("partitions every per-network var into exactly one bucket", () => {
    const inheritable = new Set(INHERITABLE_NETWORK_VARS);
    for (const key of PER_NETWORK_VARS) {
      const isChainSpecific = CHAIN_SPECIFIC_NETWORK_VARS.has(key);
      expect(isChainSpecific).toBe(!inheritable.has(key));
    }
    expect(inheritable.size + CHAIN_SPECIFIC_NETWORK_VARS.size).toBe(PER_NETWORK_VARS.length);
  });

  it("keeps credentials and chain endpoints chain-specific (never inherited)", () => {
    for (const key of [
      "WALLET_ADDRESS",
      "WALLET_PRIVATE_KEY",
      "SESSION_KEY_PRIVATE_KEY",
      "RPC_URL",
      "PDP_SUBGRAPH_ENDPOINT",
      // Dealbot-owned subgraph endpoint: chain-scoped data, so it never inherits.
      "SUBGRAPH_ENDPOINT",
      "BLOCKED_SP_IDS",
      "BLOCKED_SP_ADDRESSES",
    ] as const) {
      expect(inheritsUnprefixed(key)).toBe(false);
    }
  });

  it("marks tuning/timeout vars as inheritable", () => {
    for (const key of [
      "DEAL_JOB_TIMEOUT_SECONDS",
      "DEALS_PER_SP_PER_HOUR",
      "SAMPLED_RETRIEVALS_PER_SP_PER_HOUR",
      "SAMPLED_RETRIEVAL_JOB_TIMEOUT_SECONDS",
      "MAINTENANCE_WINDOWS_UTC",
      "MAX_DATASET_STORAGE_SIZE_BYTES",
    ] as const) {
      expect(inheritsUnprefixed(key)).toBe(true);
    }
  });
});
