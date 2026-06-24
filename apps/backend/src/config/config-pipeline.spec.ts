import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateConfig } from "./env.schema.js";
import { loadConfig } from "./loader.js";

/**
 * End-to-end of the config pipeline as NestJS runs it: `validateConfig` first
 * (legacy/rename translation + Joi), then `loadConfig` reading `process.env`.
 * Both touch the real `process.env`, so each case snapshots and restores it.
 */
const TOUCHED = [
  "NETWORK",
  "NETWORKS",
  "DATABASE_HOST",
  "DATABASE_USER",
  "DATABASE_PASSWORD",
  "DATABASE_NAME",
  "WALLET_ADDRESS",
  "SESSION_KEY_PRIVATE_KEY",
  "WALLET_PRIVATE_KEY",
  "RPC_URL",
  "DEALBOT_MAINTENANCE_WINDOWS_UTC",
  "MAINTENANCE_WINDOWS_UTC",
  "DEAL_JOB_TIMEOUT_SECONDS",
  "CALIBRATION_WALLET_ADDRESS",
  "CALIBRATION_SESSION_KEY_PRIVATE_KEY",
  "CALIBRATION_WALLET_PRIVATE_KEY",
  "CALIBRATION_RPC_URL",
  "CALIBRATION_MAINTENANCE_WINDOWS_UTC",
  "MAINNET_WALLET_PRIVATE_KEY",
  "MAINNET_WALLET_ADDRESS",
  "MAINNET_DEAL_JOB_TIMEOUT_SECONDS",
];

const snapshot: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of TOUCHED) {
    snapshot[key] = process.env[key];
    delete process.env[key];
  }
  process.env.DATABASE_HOST = "localhost";
  process.env.DATABASE_USER = "test";
  process.env.DATABASE_PASSWORD = "test";
  process.env.DATABASE_NAME = "test";
});

afterEach(() => {
  for (const key of TOUCHED) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
});

describe("config pipeline (validateConfig -> loadConfig)", () => {
  it("rolls a legacy single-network deployment forward, including renamed vars", () => {
    // Staging-style: legacy NETWORK + session-key mode + an old maintenance name.
    process.env.NETWORK = "calibration";
    process.env.WALLET_ADDRESS = "0xabc";
    process.env.SESSION_KEY_PRIVATE_KEY = "0xsession";
    process.env.RPC_URL = "http://erpc.local/main/evm/314159";
    process.env.DEALBOT_MAINTENANCE_WINDOWS_UTC = "01:00,13:00";

    expect(() => validateConfig(process.env as Record<string, unknown>)).not.toThrow();
    const cfg = loadConfig();

    expect(cfg.activeNetworks).toEqual(["calibration"]);
    expect(cfg.networks.calibration.rpcUrl).toBe("http://erpc.local/main/evm/314159");
    expect(cfg.networks.calibration.maintenanceWindowsUtc).toEqual(["01:00", "13:00"]);
    if ("sessionKeyPrivateKey" in cfg.networks.calibration) {
      expect(cfg.networks.calibration.sessionKeyPrivateKey).toBe("0xsession");
    } else {
      throw new Error("expected session-key variant");
    }
  });

  it("validates and loads a shared value with a per-network override across both networks", () => {
    process.env.NETWORKS = "calibration,mainnet";
    process.env.CALIBRATION_WALLET_PRIVATE_KEY = "0xcal";
    process.env.CALIBRATION_WALLET_ADDRESS = "0xcaladdr";
    process.env.MAINNET_WALLET_PRIVATE_KEY = "0xmain";
    process.env.MAINNET_WALLET_ADDRESS = "0xmainaddr";
    process.env.DEAL_JOB_TIMEOUT_SECONDS = "500"; // shared, validated once
    process.env.MAINNET_DEAL_JOB_TIMEOUT_SECONDS = "900"; // override

    expect(() => validateConfig(process.env as Record<string, unknown>)).not.toThrow();
    const cfg = loadConfig();

    expect(cfg.activeNetworks).toEqual(["calibration", "mainnet"]);
    expect(cfg.networks.calibration.dealJobTimeoutSeconds).toBe(500);
    expect(cfg.networks.mainnet.dealJobTimeoutSeconds).toBe(900);
  });

  it("rejects an out-of-range shared value before load", () => {
    process.env.NETWORKS = "calibration";
    process.env.CALIBRATION_WALLET_PRIVATE_KEY = "0xcal";
    process.env.CALIBRATION_WALLET_ADDRESS = "0xcaladdr";
    process.env.DEAL_JOB_TIMEOUT_SECONDS = "1"; // below min(120)

    expect(() => validateConfig(process.env as Record<string, unknown>)).toThrow(/DEAL_JOB_TIMEOUT_SECONDS/);
  });
});
