import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "./loader.js";

/**
 * `loadConfig` reads from `process.env` directly, so tests snapshot and
 * restore the real env around each case. Only keys touched by a test are
 * cleared on reset.
 */
const KEYS_TO_RESET = [
  "NETWORKS",
  "NETWORK",
  "CALIBRATION_WALLET_PRIVATE_KEY",
  "CALIBRATION_SESSION_KEY_PRIVATE_KEY",
  "CALIBRATION_WALLET_ADDRESS",
  "CALIBRATION_RPC_URL",
  "CALIBRATION_DEALS_PER_SP_PER_HOUR",
  "CALIBRATION_BLOCKED_SP_IDS",
  "CALIBRATION_DEAL_JOB_TIMEOUT_SECONDS",
  "CALIBRATION_MAINTENANCE_WINDOWS_UTC",
  "CALIBRATION_CHECK_DATASET_CREATION_FEES",
  "CALIBRATION_TARGET_DATASET_STORAGE_SIZE_BYTES",
  "CALIBRATION_MAX_DATASET_STORAGE_SIZE_BYTES",
  "CALIBRATION_PDP_SUBGRAPH_ENDPOINT",
  "CALIBRATION_CLICKHOUSE_URL",
  "MAINNET_WALLET_PRIVATE_KEY",
  "MAINNET_SESSION_KEY_PRIVATE_KEY",
  "MAINNET_WALLET_ADDRESS",
  "MAINNET_RPC_URL",
  "MAINNET_DEAL_JOB_TIMEOUT_SECONDS",
  "MAINNET_CLICKHOUSE_URL",
  "WALLET_PRIVATE_KEY",
  "WALLET_ADDRESS",
  "RPC_URL",
  "DEALS_PER_SP_PER_HOUR",
  "BLOCKED_SP_IDS",
  "SESSION_KEY_PRIVATE_KEY",
  "DEAL_JOB_TIMEOUT_SECONDS",
  "MAINTENANCE_WINDOWS_UTC",
  "CHECK_DATASET_CREATION_FEES",
  "PDP_SUBGRAPH_ENDPOINT",
  "MAX_DATASET_STORAGE_SIZE_BYTES",
  "TARGET_DATASET_STORAGE_SIZE_BYTES",
  "DATASET_LIFECYCLE_CHECK_ENABLED",
  "CALIBRATION_DATASET_LIFECYCLE_CHECK_ENABLED",
  "MAINNET_DATASET_LIFECYCLE_CHECK_ENABLED",
  "CLICKHOUSE_URL",
  "CLICKHOUSE_BATCH_SIZE",
  "CLICKHOUSE_FLUSH_INTERVAL_MS",
  "CLICKHOUSE_MAX_BUFFER_SIZE",
  "DEALBOT_API_PUBLIC_URL",
];

const snapshot: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS_TO_RESET) {
    snapshot[key] = process.env[key];
    delete process.env[key];
  }
  process.env.DATABASE_HOST = process.env.DATABASE_HOST ?? "localhost";
  process.env.DATABASE_USER = process.env.DATABASE_USER ?? "test";
  process.env.DATABASE_PASSWORD = process.env.DATABASE_PASSWORD ?? "test";
  process.env.DATABASE_NAME = process.env.DATABASE_NAME ?? "test";
});

afterEach(() => {
  for (const key of KEYS_TO_RESET) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
});

describe("loadConfig", () => {
  it("loads the active network from prefixed vars", () => {
    process.env.NETWORKS = "calibration";
    process.env.CALIBRATION_WALLET_PRIVATE_KEY = "0xkey";
    process.env.CALIBRATION_RPC_URL = "https://rpc.example/calibration";
    process.env.CALIBRATION_DEALS_PER_SP_PER_HOUR = "3";

    const cfg = loadConfig();

    expect(cfg.activeNetworks).toEqual(["calibration"]);
    expect(cfg.networks.calibration.network).toBe("calibration");
    expect(cfg.networks.calibration.rpcUrl).toBe("https://rpc.example/calibration");
    expect(cfg.networks.calibration.dealsPerSpPerHour).toBe(3);
    if ("walletPrivateKey" in cfg.networks.calibration) {
      expect(cfg.networks.calibration.walletPrivateKey).toBe("0xkey");
    } else {
      throw new Error("calibration should be loaded as walletPrivateKey variant");
    }
  });

  it("normalizes apiPublicUrl by trimming and stripping trailing slashes", () => {
    process.env.NETWORKS = "calibration";
    process.env.CALIBRATION_WALLET_PRIVATE_KEY = "0xkey";
    process.env.DEALBOT_API_PUBLIC_URL = "  https://dealbot.example.com///  ";

    expect(loadConfig().app.apiPublicUrl).toBe("https://dealbot.example.com");
  });

  it("treats a blank apiPublicUrl as undefined", () => {
    process.env.NETWORKS = "calibration";
    process.env.CALIBRATION_WALLET_PRIVATE_KEY = "0xkey";
    process.env.DEALBOT_API_PUBLIC_URL = "   ";

    expect(loadConfig().app.apiPublicUrl).toBeUndefined();
  });

  it("loads both networks when both are listed in NETWORKS", () => {
    process.env.NETWORKS = "calibration,mainnet";
    process.env.CALIBRATION_WALLET_PRIVATE_KEY = "0xcal";
    process.env.MAINNET_WALLET_PRIVATE_KEY = "0xmain";
    process.env.MAINNET_RPC_URL = "https://rpc.example/mainnet";

    const cfg = loadConfig();

    expect(cfg.activeNetworks).toEqual(["calibration", "mainnet"]);
    expect(cfg.networks.mainnet.rpcUrl).toBe("https://rpc.example/mainnet");
  });

  it("loads network-specific ClickHouse URLs with shared batching settings", () => {
    process.env.NETWORKS = "calibration,mainnet";
    process.env.CALIBRATION_WALLET_PRIVATE_KEY = "0xcal";
    process.env.MAINNET_WALLET_PRIVATE_KEY = "0xmain";
    process.env.CALIBRATION_CLICKHOUSE_URL = "http://clickhouse.example:8123/dealbot_calibration";
    process.env.MAINNET_CLICKHOUSE_URL = "http://clickhouse.example:8123/dealbot_mainnet";
    process.env.CLICKHOUSE_BATCH_SIZE = "250";
    process.env.CLICKHOUSE_FLUSH_INTERVAL_MS = "2000";
    process.env.CLICKHOUSE_MAX_BUFFER_SIZE = "3000";

    const cfg = loadConfig();

    expect(cfg.networks.calibration.clickhouseUrl).toBe("http://clickhouse.example:8123/dealbot_calibration");
    expect(cfg.networks.mainnet.clickhouseUrl).toBe("http://clickhouse.example:8123/dealbot_mainnet");
    expect(cfg.clickhouse).toEqual({
      batchSize: 250,
      flushIntervalMs: 2000,
      maxBufferSize: 3000,
    });
  });

  it("does not inherit an unprefixed ClickHouse URL in multi-network mode", () => {
    process.env.NETWORKS = "calibration,mainnet";
    process.env.CALIBRATION_WALLET_PRIVATE_KEY = "0xcal";
    process.env.MAINNET_WALLET_PRIVATE_KEY = "0xmain";
    process.env.CLICKHOUSE_URL = "http://clickhouse.example:8123/dealbot";

    const cfg = loadConfig();

    expect(cfg.networks.calibration.clickhouseUrl).toBeUndefined();
    expect(cfg.networks.mainnet.clickhouseUrl).toBeUndefined();
  });

  it("does not throw when an inactive network lacks wallet keys", () => {
    // Pre-refactor, the loader iterated all SUPPORTED_NETWORKS and threw on
    // missing keys for inactive networks — operators had to set keys for both.
    process.env.NETWORKS = "calibration";
    process.env.CALIBRATION_WALLET_PRIVATE_KEY = "0xkey";
    // MAINNET_WALLET_PRIVATE_KEY intentionally unset.

    expect(() => loadConfig()).not.toThrow();
  });
});

describe("loadConfig per-network inheritance", () => {
  it("inherits an unprefixed shared value on every active network", () => {
    process.env.NETWORKS = "calibration,mainnet";
    process.env.CALIBRATION_WALLET_PRIVATE_KEY = "0xcal";
    process.env.MAINNET_WALLET_PRIVATE_KEY = "0xmain";
    process.env.DEAL_JOB_TIMEOUT_SECONDS = "500";

    const cfg = loadConfig();

    expect(cfg.networks.calibration.dealJobTimeoutSeconds).toBe(500);
    expect(cfg.networks.mainnet.dealJobTimeoutSeconds).toBe(500);
  });

  it("lets a per-network override beat the shared value", () => {
    process.env.NETWORKS = "calibration,mainnet";
    process.env.CALIBRATION_WALLET_PRIVATE_KEY = "0xcal";
    process.env.MAINNET_WALLET_PRIVATE_KEY = "0xmain";
    process.env.DEAL_JOB_TIMEOUT_SECONDS = "500"; // shared
    process.env.MAINNET_DEAL_JOB_TIMEOUT_SECONDS = "900"; // override

    const cfg = loadConfig();

    expect(cfg.networks.calibration.dealJobTimeoutSeconds).toBe(500);
    expect(cfg.networks.mainnet.dealJobTimeoutSeconds).toBe(900);
  });

  it("falls back to the default when neither override nor shared is set", () => {
    process.env.NETWORKS = "calibration";
    process.env.CALIBRATION_WALLET_PRIVATE_KEY = "0xcal";

    const cfg = loadConfig();

    expect(cfg.networks.calibration.dealJobTimeoutSeconds).toBe(360); // networkDefaults
  });

  it("does NOT inherit chain-specific vars from the unprefixed slot", () => {
    process.env.NETWORKS = "calibration";
    process.env.CALIBRATION_WALLET_PRIVATE_KEY = "0xcal";
    // Unprefixed (shared) PDP_SUBGRAPH_ENDPOINT must be ignored for the network.
    process.env.PDP_SUBGRAPH_ENDPOINT = "https://shared.example/subgraph";

    const cfg = loadConfig();

    expect(cfg.networks.calibration.pdpSubgraphEndpoint).toBeUndefined();
  });

  it("throws when TARGET storage size is not below MAX (post-resolution)", () => {
    process.env.NETWORKS = "calibration";
    process.env.CALIBRATION_WALLET_PRIVATE_KEY = "0xcal";
    process.env.CALIBRATION_MAX_DATASET_STORAGE_SIZE_BYTES = "1000";
    process.env.CALIBRATION_TARGET_DATASET_STORAGE_SIZE_BYTES = "1000";

    expect(() => loadConfig()).toThrow(/TARGET_DATASET_STORAGE_SIZE_BYTES/);
  });

  it("catches TARGET>=MAX even when the two come from different precedence tiers", () => {
    process.env.NETWORKS = "calibration";
    process.env.CALIBRATION_WALLET_PRIVATE_KEY = "0xcal";
    process.env.MAX_DATASET_STORAGE_SIZE_BYTES = "1000"; // shared
    process.env.CALIBRATION_TARGET_DATASET_STORAGE_SIZE_BYTES = "2000"; // override

    expect(() => loadConfig()).toThrow(/must be less than MAX_DATASET_STORAGE_SIZE_BYTES/);
  });

  it("catches TARGET>=MAX when both come from shared unprefixed vars", () => {
    process.env.NETWORKS = "calibration";
    process.env.CALIBRATION_WALLET_PRIVATE_KEY = "0xcal";
    process.env.MAX_DATASET_STORAGE_SIZE_BYTES = "1000";
    process.env.TARGET_DATASET_STORAGE_SIZE_BYTES = "1500";

    expect(() => loadConfig()).toThrow(/TARGET_DATASET_STORAGE_SIZE_BYTES/);
  });

  it("does not let a shared DATASET_LIFECYCLE_CHECK_ENABLED enable the canary on mainnet", () => {
    process.env.NETWORKS = "calibration,mainnet";
    process.env.CALIBRATION_WALLET_PRIVATE_KEY = "0xcal";
    process.env.MAINNET_WALLET_PRIVATE_KEY = "0xmain";
    // Shared (unprefixed) value: chain-specific var must NOT inherit it.
    process.env.DATASET_LIFECYCLE_CHECK_ENABLED = "true";

    const cfg = loadConfig();

    expect(cfg.networks.calibration.dataSetLifecycleCheckEnabled).toBe(true); // network default (off mainnet only)
    expect(cfg.networks.mainnet.dataSetLifecycleCheckEnabled).toBe(false); // safety default preserved
  });

  it("throws when NETWORKS resolves to no supported networks", () => {
    process.env.NETWORKS = " , ,";

    expect(() => loadConfig()).toThrow(/NETWORKS resolved to no supported networks/);
  });

  it("reads case-variant boolean env without forcing true", () => {
    process.env.NETWORKS = "calibration";
    process.env.CALIBRATION_WALLET_PRIVATE_KEY = "0xcal";
    process.env.CHECK_DATASET_CREATION_FEES = "False"; // shared, mixed case

    const cfg = loadConfig();

    expect(cfg.networks.calibration.checkDatasetCreationFees).toBe(false);
  });
});
