import { beforeEach, describe, expect, it } from "vitest";
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
  "CALIBRATION_WALLET_ADDRESS",
  "CALIBRATION_RPC_URL",
  "CALIBRATION_DEALS_PER_SP_PER_HOUR",
  "CALIBRATION_BLOCKED_SP_IDS",
  "MAINNET_WALLET_PRIVATE_KEY",
  "MAINNET_WALLET_ADDRESS",
  "MAINNET_RPC_URL",
  "WALLET_PRIVATE_KEY",
  "WALLET_ADDRESS",
  "RPC_URL",
  "DEALS_PER_SP_PER_HOUR",
  "BLOCKED_SP_IDS",
  "SESSION_KEY_PRIVATE_KEY",
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

  return () => {
    for (const key of KEYS_TO_RESET) {
      if (snapshot[key] === undefined) delete process.env[key];
      else process.env[key] = snapshot[key];
    }
  };
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

  it("loads both networks when both are listed in NETWORKS", () => {
    process.env.NETWORKS = "calibration,mainnet";
    process.env.CALIBRATION_WALLET_PRIVATE_KEY = "0xcal";
    process.env.MAINNET_WALLET_PRIVATE_KEY = "0xmain";
    process.env.MAINNET_RPC_URL = "https://rpc.example/mainnet";

    const cfg = loadConfig();

    expect(cfg.activeNetworks).toEqual(["calibration", "mainnet"]);
    expect(cfg.networks.mainnet.rpcUrl).toBe("https://rpc.example/mainnet");
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
