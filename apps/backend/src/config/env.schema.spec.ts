import { zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import { createConfigValidationSchema } from "./env.schema.js";

/**
 * Minimum set of env vars required for validation to pass (database block
 * is always required, regardless of which networks are active).
 */
const baseEnv = {
  DATABASE_HOST: "localhost",
  DATABASE_USER: "test",
  DATABASE_PASSWORD: "test",
  DATABASE_NAME: "test",
  CALIBRATION_WALLET_ADDRESS: zeroAddress,
  MAINNET_WALLET_ADDRESS: zeroAddress,
};

/**
 * Env fragment that satisfies the per-network wallet-key `.or()` constraint
 * for a given network prefix.  Use with `...withWalletKey("CALIBRATION")`.
 */
const withWalletKey = (prefix: string) => ({ [`${prefix}_WALLET_PRIVATE_KEY`]: "0xkey" });

/**
 * Builds a schema where only the given networks are active.  Keeps tests
 * deterministic regardless of the process env that the test runner inherits.
 */
const schemaFor = (networks: string) =>
  createConfigValidationSchema({ ...baseEnv, NETWORKS: networks } as NodeJS.ProcessEnv);

const validate = (schema: ReturnType<typeof createConfigValidationSchema>, input: Record<string, unknown>) =>
  schema.validate(input, { allowUnknown: true });

describe("createConfigValidationSchema", () => {
  describe("wallet-key / session-key constraint (active networks)", () => {
    it("accepts a network with WALLET_PRIVATE_KEY only", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        CALIBRATION_WALLET_PRIVATE_KEY: "0xkey",
      });
      expect(error).toBeUndefined();
    });

    it("accepts a network with SESSION_KEY_PRIVATE_KEY only", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        CALIBRATION_SESSION_KEY_PRIVATE_KEY: "0xdeadbeef",
      });
      expect(error).toBeUndefined();
    });

    it("accepts both keys being provided (loader decides precedence)", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        CALIBRATION_WALLET_PRIVATE_KEY: "0xkey",
        CALIBRATION_SESSION_KEY_PRIVATE_KEY: "0xsession",
      });
      expect(error).toBeUndefined();
    });

    it("rejects an active network that has neither key", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
      });
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/CALIBRATION_WALLET_PRIVATE_KEY|CALIBRATION_SESSION_KEY_PRIVATE_KEY/);
    });

    it("treats empty-string wallet key as absent (must fall back to session key)", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        CALIBRATION_WALLET_PRIVATE_KEY: "",
      });
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/CALIBRATION_WALLET_PRIVATE_KEY|CALIBRATION_SESSION_KEY_PRIVATE_KEY/);
    });

    it("treats empty-string session key as absent when wallet key is present", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        CALIBRATION_WALLET_PRIVATE_KEY: "0xkey",
        CALIBRATION_SESSION_KEY_PRIVATE_KEY: "",
      });
      expect(error).toBeUndefined();
    });

    it("rejects when every active network is missing both keys (multi-network)", () => {
      const { error } = validate(schemaFor("mainnet,calibration"), {
        ...baseEnv,
        NETWORKS: "mainnet,calibration",
      });
      expect(error).toBeDefined();
    });

    it("requires each active network independently (multi-network)", () => {
      // Only mainnet has a key; calibration is active but has neither → invalid
      const { error } = validate(schemaFor("mainnet,calibration"), {
        ...baseEnv,
        NETWORKS: "mainnet,calibration",
        ...withWalletKey("MAINNET"),
      });
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/CALIBRATION_WALLET_PRIVATE_KEY|CALIBRATION_SESSION_KEY_PRIVATE_KEY/);
    });

    it("accepts multi-network when every active network provides a key", () => {
      const { error } = validate(schemaFor("mainnet,calibration"), {
        ...baseEnv,
        NETWORKS: "mainnet,calibration",
        ...withWalletKey("MAINNET"),
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeUndefined();
    });
  });

  describe("inactive networks", () => {
    it("does not require keys for an inactive network", () => {
      // Only calibration is active; mainnet has no keys → still valid
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeUndefined();
    });

    it("does not reject invalid-looking values on an inactive network", () => {
      // MAINNET is inactive, so its fields should be optional (no strict checks).
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        ...withWalletKey("CALIBRATION"),
        MAINNET_WALLET_PRIVATE_KEY: "",
        MAINNET_SESSION_KEY_PRIVATE_KEY: "",
      });
      expect(error).toBeUndefined();
    });
  });

  describe("NETWORKS env var", () => {
    it("rejects an unknown network name", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "unknownnet",
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/NETWORKS|Invalid network/);
    });

    it("rejects a mixed list containing an unknown network", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration,bogus",
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeDefined();
    });

    it("accepts a list with whitespace around entries", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: " calibration , mainnet ",
        ...withWalletKey("CALIBRATION"),
        ...withWalletKey("MAINNET"),
      });
      expect(error).toBeUndefined();
    });

    it("falls back to the default when NETWORKS is absent", () => {
      const { error, value } = validate(schemaFor("calibration"), {
        ...baseEnv,
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeUndefined();
      expect(value.NETWORKS).toBeTruthy();
    });
  });

  describe("database block", () => {
    it.each(["DATABASE_HOST", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME"] as const)("requires %s", (key) => {
      const env: Record<string, unknown> = {
        ...baseEnv,
        NETWORKS: "calibration",
        ...withWalletKey("CALIBRATION"),
      };
      delete env[key];
      const { error } = validate(schemaFor("calibration"), env);
      expect(error).toBeDefined();
      expect(error?.message).toMatch(new RegExp(key));
    });

    it("defaults DATABASE_PORT to 5432 when absent", () => {
      const { value } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        ...withWalletKey("CALIBRATION"),
      });
      expect(value.DATABASE_PORT).toBe(5432);
    });

    it("rejects a non-numeric DATABASE_PORT", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        DATABASE_PORT: "abc",
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/DATABASE_PORT/);
    });

    it("rejects DATABASE_POOL_MAX below the minimum", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        DATABASE_POOL_MAX: 0,
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/DATABASE_POOL_MAX/);
    });
  });

  describe("app block", () => {
    it("rejects an unknown NODE_ENV", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        NODE_ENV: "staging",
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/NODE_ENV/);
    });

    it("rejects an unknown DEALBOT_RUN_MODE", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        DEALBOT_RUN_MODE: "invalid-mode",
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/DEALBOT_RUN_MODE/);
    });

    it("lowercases DEALBOT_RUN_MODE before validation", () => {
      const { error, value } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        DEALBOT_RUN_MODE: "WORKER",
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeUndefined();
      expect(value.DEALBOT_RUN_MODE).toBe("worker");
    });

    it("applies sensible defaults for all optional app fields", () => {
      const { error, value } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeUndefined();
      expect(value.NODE_ENV).toBe("development");
      expect(value.DEALBOT_RUN_MODE).toBe("both");
      expect(value.DEALBOT_PORT).toBe(3000);
      expect(value.ENABLE_DEV_MODE).toBe(false);
      expect(value.PROMETHEUS_WALLET_BALANCE_TTL_SECONDS).toBe(3600);
    });

    it("enforces PROMETHEUS_WALLET_BALANCE_TTL_SECONDS minimum of 60", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        PROMETHEUS_WALLET_BALANCE_TTL_SECONDS: 59,
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/PROMETHEUS_WALLET_BALANCE_TTL_SECONDS/);
    });

    it("coerces ENABLE_DEV_MODE boolean strings", () => {
      const { error, value } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        ENABLE_DEV_MODE: "true",
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeUndefined();
      expect(value.ENABLE_DEV_MODE).toBe(true);
    });
  });

  describe("per-network fields (active network)", () => {
    it("rejects an RPC URL without an http(s) scheme", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        CALIBRATION_RPC_URL: "ftp://example.com",
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/CALIBRATION_RPC_URL/);
    });

    it("accepts an empty RPC URL string", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        CALIBRATION_RPC_URL: "",
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeUndefined();
    });

    it("rejects METRICS_PER_HOUR above the maximum", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        CALIBRATION_METRICS_PER_HOUR: 4,
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/CALIBRATION_METRICS_PER_HOUR/);
    });

    it("rejects DEALS_PER_SP_PER_HOUR at zero (below min)", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        CALIBRATION_DEALS_PER_SP_PER_HOUR: 0,
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeDefined();
    });

    it("rejects MIN_NUM_DATASETS_FOR_CHECKS when non-integer", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        CALIBRATION_MIN_NUM_DATASETS_FOR_CHECKS: 1.5,
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/CALIBRATION_MIN_NUM_DATASETS_FOR_CHECKS/);
    });
  });

  describe("maintenance windows", () => {
    it("accepts a valid comma-separated schedule", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        CALIBRATION_MAINTENANCE_WINDOWS_UTC: "06:30,18:00",
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeUndefined();
    });

    it("rejects an invalid hour", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        CALIBRATION_MAINTENANCE_WINDOWS_UTC: "25:00",
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/CALIBRATION_MAINTENANCE_WINDOWS_UTC/);
    });

    it("rejects an invalid minute", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        CALIBRATION_MAINTENANCE_WINDOWS_UTC: "07:70",
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeDefined();
    });

    it("rejects a malformed entry", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        CALIBRATION_MAINTENANCE_WINDOWS_UTC: "7am",
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeDefined();
    });

    it("rejects MAINTENANCE_WINDOW_MINUTES below 20", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        CALIBRATION_MAINTENANCE_WINDOW_MINUTES: 10,
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/CALIBRATION_MAINTENANCE_WINDOW_MINUTES/);
    });

    it("rejects MAINTENANCE_WINDOW_MINUTES above 360", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        CALIBRATION_MAINTENANCE_WINDOW_MINUTES: 361,
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeDefined();
    });
  });

  describe("jobs block", () => {
    it("applies defaults when absent", () => {
      const { error, value } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeUndefined();
      expect(value.JOB_SCHEDULER_POLL_SECONDS).toBe(300);
      expect(value.JOB_WORKER_POLL_SECONDS).toBe(60);
      expect(value.PG_BOSS_LOCAL_CONCURRENCY).toBe(20);
      expect(value.DEALBOT_PGBOSS_SCHEDULER_ENABLED).toBe(true);
      expect(value.DEAL_JOB_TIMEOUT_SECONDS).toBe(360);
    });

    it("rejects JOB_SCHEDULER_POLL_SECONDS below 60", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        JOB_SCHEDULER_POLL_SECONDS: 30,
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeDefined();
    });

    it("rejects DEAL_JOB_TIMEOUT_SECONDS below 120", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        DEAL_JOB_TIMEOUT_SECONDS: 60,
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeDefined();
    });

    it("rejects non-integer PG_BOSS_LOCAL_CONCURRENCY", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        PG_BOSS_LOCAL_CONCURRENCY: 2.5,
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/PG_BOSS_LOCAL_CONCURRENCY/);
    });
  });

  describe("timeout block", () => {
    it("enforces CONNECT_TIMEOUT_MS >= 1000", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        CONNECT_TIMEOUT_MS: 500,
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeDefined();
    });

    it("enforces IPNI_VERIFICATION_POLLING_MS >= 250", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        IPNI_VERIFICATION_POLLING_MS: 100,
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeDefined();
    });
  });

  describe("retrieval block", () => {
    it("rejects IPFS_BLOCK_FETCH_CONCURRENCY above 32", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        IPFS_BLOCK_FETCH_CONCURRENCY: 33,
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/IPFS_BLOCK_FETCH_CONCURRENCY/);
    });

    it("rejects IPFS_BLOCK_FETCH_CONCURRENCY when zero", () => {
      const { error } = validate(schemaFor("calibration"), {
        ...baseEnv,
        NETWORKS: "calibration",
        IPFS_BLOCK_FETCH_CONCURRENCY: 0,
        ...withWalletKey("CALIBRATION"),
      });
      expect(error).toBeDefined();
    });
  });

  describe("stability", () => {
    it("returns a fresh schema instance per call", () => {
      const a = schemaFor("calibration");
      const b = schemaFor("calibration");
      expect(a).not.toBe(b);
    });
  });
});
