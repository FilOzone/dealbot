import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyLegacyEnvCompat, logLegacyEnvCompatResult } from "./legacy-env-compat.js";

/** Build a fresh env map for every test — never mutate `process.env`. */
const envOf = (overrides: Record<string, string> = {}): NodeJS.ProcessEnv => ({ ...overrides }) as NodeJS.ProcessEnv;

describe("applyLegacyEnvCompat", () => {
  describe("skips translation", () => {
    it("returns skipReason=networks_already_set when NETWORKS is set", () => {
      const env = envOf({ NETWORKS: "calibration", NETWORK: "mainnet", WALLET_PRIVATE_KEY: "0xkey" });
      const before = { ...env };
      const result = applyLegacyEnvCompat(env);
      expect(result.applied).toBe(false);
      expect(result.skipReason).toBe("networks_already_set");
      expect(result.translatedVars).toEqual([]);
      // Env left untouched.
      expect(env).toEqual(before);
    });

    it("returns skipReason=no_legacy_network when NETWORK is absent", () => {
      const env = envOf();
      const result = applyLegacyEnvCompat(env);
      expect(result.applied).toBe(false);
      expect(result.skipReason).toBe("no_legacy_network");
    });

    it("returns skipReason=no_legacy_network when NETWORK is whitespace", () => {
      const env = envOf({ NETWORK: "   " });
      const result = applyLegacyEnvCompat(env);
      expect(result.applied).toBe(false);
      expect(result.skipReason).toBe("no_legacy_network");
    });

    it("returns skipReason=invalid_legacy_network when NETWORK is unsupported", () => {
      const env = envOf({ NETWORK: "moonbase" });
      const result = applyLegacyEnvCompat(env);
      expect(result.applied).toBe(false);
      expect(result.skipReason).toBe("invalid_legacy_network");
      // Must not set NETWORKS to anything bogus.
      expect(env.NETWORKS).toBeUndefined();
    });
  });

  describe("translates when legacy NETWORK is set", () => {
    it("sets NETWORKS and copies each unprefixed var to its prefixed slot", () => {
      const env = envOf({
        NETWORK: "calibration",
        WALLET_PRIVATE_KEY: "0xkey",
        WALLET_ADDRESS: "0xabc",
        RPC_URL: "https://rpc.example",
        DEALS_PER_SP_PER_HOUR: "3",
      });
      const result = applyLegacyEnvCompat(env);

      expect(result.applied).toBe(true);
      expect(result.network).toBe("calibration");
      expect(result.translatedVars).toEqual(
        expect.arrayContaining(["WALLET_PRIVATE_KEY", "WALLET_ADDRESS", "RPC_URL", "DEALS_PER_SP_PER_HOUR"]),
      );
      expect(env.NETWORKS).toBe("calibration");
      expect(env.CALIBRATION_WALLET_PRIVATE_KEY).toBe("0xkey");
      expect(env.CALIBRATION_WALLET_ADDRESS).toBe("0xabc");
      expect(env.CALIBRATION_RPC_URL).toBe("https://rpc.example");
      expect(env.CALIBRATION_DEALS_PER_SP_PER_HOUR).toBe("3");
    });

    it("normalises case-variant NETWORK values", () => {
      const env = envOf({ NETWORK: "MAINNET", WALLET_PRIVATE_KEY: "0xkey" });
      const result = applyLegacyEnvCompat(env);

      expect(result.applied).toBe(true);
      expect(result.network).toBe("mainnet");
      expect(env.NETWORKS).toBe("mainnet");
      expect(env.MAINNET_WALLET_PRIVATE_KEY).toBe("0xkey");
    });

    it("does not overwrite an already-set prefixed var (explicit wins)", () => {
      const env = envOf({
        NETWORK: "calibration",
        WALLET_PRIVATE_KEY: "0xlegacy",
        CALIBRATION_WALLET_PRIVATE_KEY: "0xexplicit",
      });
      const result = applyLegacyEnvCompat(env);

      expect(result.applied).toBe(true);
      expect(env.CALIBRATION_WALLET_PRIVATE_KEY).toBe("0xexplicit");
      // The legacy var is still present but was not re-copied.
      expect(result.translatedVars).not.toContain("WALLET_PRIVATE_KEY");
    });

    it("skips empty legacy values", () => {
      const env = envOf({ NETWORK: "calibration", WALLET_PRIVATE_KEY: "0xkey", RPC_URL: "" });
      const result = applyLegacyEnvCompat(env);

      expect(result.applied).toBe(true);
      expect(result.translatedVars).not.toContain("RPC_URL");
      expect(env.CALIBRATION_RPC_URL).toBeUndefined();
    });

    it("does not carry data between distinct env maps (no shared state)", () => {
      const a = envOf({ NETWORK: "calibration", WALLET_PRIVATE_KEY: "0xa" });
      const b = envOf({ NETWORK: "mainnet", WALLET_PRIVATE_KEY: "0xb" });
      applyLegacyEnvCompat(a);
      applyLegacyEnvCompat(b);
      expect(a.CALIBRATION_WALLET_PRIVATE_KEY).toBe("0xa");
      expect(a.MAINNET_WALLET_PRIVATE_KEY).toBeUndefined();
      expect(b.MAINNET_WALLET_PRIVATE_KEY).toBe("0xb");
      expect(b.CALIBRATION_WALLET_PRIVATE_KEY).toBeUndefined();
    });
  });
});

describe("logLegacyEnvCompatResult", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("is a no-op when translation was not applied", () => {
    logLegacyEnvCompatResult({ applied: false, translatedVars: [], skipReason: "networks_already_set" });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("emits a structured JSON warning when translation was applied", () => {
    logLegacyEnvCompatResult({
      applied: true,
      network: "calibration",
      translatedVars: ["WALLET_PRIVATE_KEY", "RPC_URL"],
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(payload.event).toBe("config_legacy_env_detected");
    expect(payload.network).toBe("calibration");
    expect(payload.translatedVars).toEqual(["WALLET_PRIVATE_KEY", "RPC_URL"]);
  });
});
