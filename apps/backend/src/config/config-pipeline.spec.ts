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
  "DEALBOT_MAINTENANCE_WINDOW_MINUTES",
  "MAINTENANCE_WINDOW_MINUTES",
  "DEAL_JOB_TIMEOUT_SECONDS",
  "DATASET_LIFECYCLE_CHECK_ENABLED",
  "CALIBRATION_WALLET_ADDRESS",
  "CALIBRATION_SESSION_KEY_PRIVATE_KEY",
  "CALIBRATION_WALLET_PRIVATE_KEY",
  "CALIBRATION_RPC_URL",
  "CALIBRATION_MAINTENANCE_WINDOWS_UTC",
  "CALIBRATION_DEAL_JOB_TIMEOUT_SECONDS",
  "CALIBRATION_DATASET_LIFECYCLE_CHECK_ENABLED",
  "MAINNET_WALLET_PRIVATE_KEY",
  "MAINNET_WALLET_ADDRESS",
  "MAINNET_DEAL_JOB_TIMEOUT_SECONDS",
  "MAINNET_DATASET_LIFECYCLE_CHECK_ENABLED",
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

  it("carries a shared value sourced only from a .env file (not the OS env) through to the loader", () => {
    // Faithful to @nestjs/config: it validates a merged object, then assigns
    // ONLY the returned keys back into process.env (and only when not already
    // present). A `.env`-file value lives in that object, not in process.env, so
    // the loader sees it only if validateConfig keeps it in its output.
    const envFile: Record<string, string> = {
      NETWORKS: "calibration,mainnet",
      DATABASE_HOST: "localhost",
      DATABASE_USER: "test",
      DATABASE_PASSWORD: "test",
      DATABASE_NAME: "test",
      CALIBRATION_WALLET_PRIVATE_KEY: "0xcal",
      CALIBRATION_WALLET_ADDRESS: "0xcaladdr",
      MAINNET_WALLET_PRIVATE_KEY: "0xmain",
      MAINNET_WALLET_ADDRESS: "0xmainaddr",
      DEAL_JOB_TIMEOUT_SECONDS: "500", // shared, file-only
    };

    const config = { ...envFile, ...process.env };
    const validated = validateConfig(config) as Record<string, unknown>;
    for (const key of Object.keys(validated)) {
      if (!(key in process.env)) process.env[key] = String(validated[key]);
    }

    const cfg = loadConfig();
    expect(cfg.networks.calibration.dealJobTimeoutSeconds).toBe(500);
    expect(cfg.networks.mainnet.dealJobTimeoutSeconds).toBe(500);
  });

  it("promotes a renamed legacy var through the Nest copy path to both networks", () => {
    // Multi-network + only the OLD name set. The rename happens on Nest's copy;
    // the promoted current name must survive validation and be assigned to
    // process.env so the loader inherits it (regression for the strip bug).
    const envFile: Record<string, string> = {
      NETWORKS: "calibration,mainnet",
      DATABASE_HOST: "localhost",
      DATABASE_USER: "test",
      DATABASE_PASSWORD: "test",
      DATABASE_NAME: "test",
      CALIBRATION_WALLET_PRIVATE_KEY: "0xcal",
      CALIBRATION_WALLET_ADDRESS: "0xcaladdr",
      MAINNET_WALLET_PRIVATE_KEY: "0xmain",
      MAINNET_WALLET_ADDRESS: "0xmainaddr",
      DEALBOT_MAINTENANCE_WINDOW_MINUTES: "45", // old name only
    };

    const config = { ...envFile, ...process.env };
    const validated = validateConfig(config) as Record<string, unknown>;
    for (const key of Object.keys(validated)) {
      if (!(key in process.env)) process.env[key] = String(validated[key]);
    }

    const cfg = loadConfig();
    expect(cfg.networks.calibration.maintenanceWindowMinutes).toBe(45);
    expect(cfg.networks.mainnet.maintenanceWindowMinutes).toBe(45);
  });

  it("does not inject a prefixed per-network Joi default into process.env", () => {
    // The core inheritance fix: prefixed keys carry no Joi default, so an absent
    // override is NOT written back to process.env where it would shadow a shared value.
    const config = {
      NETWORKS: "calibration",
      DATABASE_HOST: "localhost",
      DATABASE_USER: "test",
      DATABASE_PASSWORD: "test",
      DATABASE_NAME: "test",
      CALIBRATION_WALLET_PRIVATE_KEY: "0xcal",
      CALIBRATION_WALLET_ADDRESS: "0xcaladdr",
    };
    const validated = validateConfig(config) as Record<string, unknown>;
    for (const key of Object.keys(validated)) {
      if (!(key in process.env)) process.env[key] = String(validated[key]);
    }

    expect(process.env.CALIBRATION_DEAL_JOB_TIMEOUT_SECONDS).toBeUndefined();
  });
});
