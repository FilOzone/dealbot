/**
 * Joi validation schemas for all environment variables.
 *
 * Structure
 * ---------
 * Individual schema objects are exported so tests can validate specific
 * slices in isolation.  `createConfigValidationSchema()` assembles the final
 * Joi object schema that NestJS `ConfigModule` consumes.
 *
 * Per-network rules
 * -----------------
 * `createPerNetworkEnvSchema(prefix)` produces the field rules for one
 * network prefix (e.g. "CALIBRATION").  `createConfigValidationSchema`
 * iterates all prefixes and:
 *   - applies rules as-is for ACTIVE networks (and queues the wallet-key
 *     `.or()` constraint)
 *   - marks every field `.optional()` for INACTIVE networks so those env
 *     vars are never required.
 */

import Joi from "joi";
import { DEFAULT_LOCAL_DATASETS_PATH, SUPPORTED_NETWORKS } from "../common/constants.js";
import { parseMaintenanceWindowTimes } from "../common/maintenance-window.js";
import type { Network } from "../common/types.js";
import { NETWORK_ENV_PREFIXES } from "./constants.js";
import { parseActiveNetworks } from "./env.parsers.js";
import { applyLegacyEnvCompat, logLegacyEnvCompatResult } from "./legacy-env-compat.js";
import { INHERITABLE_NETWORK_VARS, type PerNetworkVar } from "./network-fields.js";

// ---------------------------------------------------------------------------
// Custom Joi validators
// ---------------------------------------------------------------------------

const validateNetworksEnv = (value: string, helpers: Joi.CustomHelpers) => {
  const parts = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (parts.length === 0) {
    // A present-but-empty NETWORKS (whitespace/commas) would otherwise load zero
    // active networks and boot an idle process. Reject it explicitly.
    return helpers.message({
      custom: `NETWORKS must list at least one supported network: ${SUPPORTED_NETWORKS.join(", ")}.`,
    });
  }

  for (const part of parts) {
    if (!SUPPORTED_NETWORKS.includes(part as Network)) {
      return helpers.message({
        custom: `Invalid network "${part}". Supported: ${SUPPORTED_NETWORKS.join(", ")}.`,
      });
    }
  }

  return value;
};

const validateMaintenanceWindowsEnv = (value: string, helpers: Joi.CustomHelpers) => {
  try {
    parseMaintenanceWindowTimes(value.split(","));
  } catch (error) {
    return helpers.error("any.invalid", {
      message: error instanceof Error ? error.message : "Invalid maintenance window format",
    });
  }
  return value;
};

// ---------------------------------------------------------------------------
// Static schema slices (one per config section)
// ---------------------------------------------------------------------------

export const appEnvSchema = {
  NODE_ENV: Joi.string().valid("development", "production", "test").default("development"),
  DEALBOT_RUN_MODE: Joi.string().lowercase().valid("api", "worker", "both").default("both"),
  DEALBOT_PORT: Joi.number().default(3000),
  DEALBOT_HOST: Joi.string().default("127.0.0.1"),
  DEALBOT_API_PUBLIC_URL: Joi.string().uri().optional().allow(""),
  DEALBOT_METRICS_PORT: Joi.number().default(9090),
  DEALBOT_METRICS_HOST: Joi.string().default("0.0.0.0"),
  ENABLE_DEV_MODE: Joi.boolean().default(false),
  PROMETHEUS_WALLET_BALANCE_TTL_SECONDS: Joi.number().min(60).default(3600),
  PROMETHEUS_WALLET_BALANCE_ERROR_COOLDOWN_SECONDS: Joi.number().min(1).default(60),
  DEALBOT_PROBE_LOCATION: Joi.string().default("unknown"),
};

export const databaseEnvSchema = {
  DATABASE_HOST: Joi.string().required(),
  DATABASE_PORT: Joi.number().default(5432),
  DATABASE_POOL_MAX: Joi.number().integer().min(1).default(1),
  DATABASE_USER: Joi.string().required(),
  DATABASE_PASSWORD: Joi.string().required(),
  DATABASE_NAME: Joi.string().required(),
};

export const globalNetworkEnvSchema = {
  NETWORKS: Joi.string().default(SUPPORTED_NETWORKS[0]).custom(validateNetworksEnv),
};

export const jobsEnvSchema = {
  JOB_SCHEDULER_POLL_SECONDS: Joi.number().min(60).default(300),
  JOB_WORKER_POLL_SECONDS: Joi.number().min(5).default(60),
  PG_BOSS_LOCAL_CONCURRENCY: Joi.number().integer().min(1).default(20),
  DEALBOT_PGBOSS_SCHEDULER_ENABLED: Joi.boolean().default(true),
  DEALBOT_PGBOSS_POOL_MAX: Joi.number().integer().min(1).default(1),
  JOB_CATCHUP_MAX_ENQUEUE: Joi.number().min(1).default(10),
  JOB_SCHEDULE_PHASE_SECONDS: Joi.number().min(0).default(0),
  JOB_ENQUEUE_JITTER_SECONDS: Joi.number().min(0).default(0),
  SHUTDOWN_FINAL_SCRAPE_DELAY_SECONDS: Joi.number().min(0).max(300).default(35),
};

export const pullPieceEnvSchema = {
  PULL_PIECE_MAX_CONCURRENT_STREAMS: Joi.number().integer().min(1).default(50),
  PULL_PIECE_MAX_STREAMS_PER_CID: Joi.number().integer().min(1).default(3),
};

export const clickhouseEnvSchema = {
  CLICKHOUSE_URL: Joi.string().uri().optional(),
  CLICKHOUSE_BATCH_SIZE: Joi.number().integer().min(1).default(500),
  CLICKHOUSE_FLUSH_INTERVAL_MS: Joi.number().integer().min(100).default(5000),
  CLICKHOUSE_MAX_BUFFER_SIZE: Joi.number().integer().min(1).default(5000),
};

export const datasetEnvSchema = {
  DEALBOT_LOCAL_DATASETS_PATH: Joi.string().default(DEFAULT_LOCAL_DATASETS_PATH),
  RANDOM_PIECE_SIZES: Joi.string().default("10485760"),
};

export const timeoutEnvSchema = {
  CONNECT_TIMEOUT_MS: Joi.number().min(1000).default(10000),
  HTTP_REQUEST_TIMEOUT_MS: Joi.number().min(1000).default(240000),
  HTTP2_REQUEST_TIMEOUT_MS: Joi.number().min(1000).default(240000),
  IPNI_VERIFICATION_TIMEOUT_MS: Joi.number().min(1000).default(60000),
  IPNI_VERIFICATION_POLLING_MS: Joi.number().min(250).default(2000),
};

export const retrievalEnvSchema = {
  IPFS_BLOCK_FETCH_CONCURRENCY: Joi.number().integer().min(1).max(32).default(6),
};

// ---------------------------------------------------------------------------
// Per-network schema factory
// ---------------------------------------------------------------------------

/**
 * Validation rules for each per-network var, keyed by base name (no prefix).
 *
 * These carry NO `.default()` on purpose. NestJS assigns Joi-applied defaults
 * back into `process.env` for absent keys; an injected prefixed default
 * (`CALIBRATION_DEAL_JOB_TIMEOUT_SECONDS`) would then shadow an unprefixed
 * shared value in the loader's resolver and break inheritance. All per-network
 * defaults live in the loader (`networkDefaults`) instead. Cross-field checks
 * (e.g. TARGET < MAX) also live in the loader, post-resolution.
 */
const perNetworkFieldRules = (): Record<PerNetworkVar, Joi.Schema> => ({
  WALLET_ADDRESS: Joi.string().required(),
  WALLET_PRIVATE_KEY: Joi.string().optional().empty(""),
  SESSION_KEY_PRIVATE_KEY: Joi.string().optional().empty(""),
  RPC_URL: Joi.string()
    .uri({ scheme: ["http", "https"] })
    .optional()
    .allow(""),
  RPC_REQUEST_TIMEOUT_MS: Joi.number().integer().min(1000).optional(),
  PDP_SUBGRAPH_ENDPOINT: Joi.string().uri().optional().allow(""),
  CHECK_DATASET_CREATION_FEES: Joi.boolean().optional(),
  USE_ONLY_APPROVED_PROVIDERS: Joi.boolean().optional(),
  DEALBOT_DATASET_VERSION: Joi.string().optional(),
  MIN_NUM_DATASETS_FOR_CHECKS: Joi.number().integer().min(1).optional(),
  DEALS_PER_SP_PER_HOUR: Joi.number().min(0.001).max(20).optional(),
  RETRIEVALS_PER_SP_PER_HOUR: Joi.number().min(0.001).max(20).optional(),
  DATASET_CREATIONS_PER_SP_PER_HOUR: Joi.number().min(0.001).max(20).optional(),
  DATASET_LIFECYCLE_CHECKS_PER_SP_PER_HOUR: Joi.number().min(0.001).max(20).optional(),
  DATASET_LIFECYCLE_CHECK_ENABLED: Joi.boolean().optional(),
  DEAL_JOB_TIMEOUT_SECONDS: Joi.number().min(120).optional(),
  RETRIEVAL_JOB_TIMEOUT_SECONDS: Joi.number().min(60).optional(),
  DATA_SET_CREATION_JOB_TIMEOUT_SECONDS: Joi.number().min(60).optional(),
  DATA_SET_LIFECYCLE_CHECK_JOB_TIMEOUT_SECONDS: Joi.number().min(60).optional(),
  DATA_RETENTION_POLL_INTERVAL_SECONDS: Joi.number().optional(),
  PROVIDERS_REFRESH_INTERVAL_SECONDS: Joi.number().optional(),
  MAINTENANCE_WINDOWS_UTC: Joi.string().custom(validateMaintenanceWindowsEnv).optional(),
  MAINTENANCE_WINDOW_MINUTES: Joi.number().min(20).max(360).optional(),
  BLOCKED_SP_IDS: Joi.string().optional().allow(""),
  BLOCKED_SP_ADDRESSES: Joi.string().optional().allow(""),
  PIECE_CLEANUP_PER_SP_PER_HOUR: Joi.number().min(0.001).max(20).optional(),
  MAX_PIECE_CLEANUP_RUNTIME_SECONDS: Joi.number().min(60).optional(),
  MAX_DATASET_STORAGE_SIZE_BYTES: Joi.number().integer().min(1).optional(),
  TARGET_DATASET_STORAGE_SIZE_BYTES: Joi.number().integer().min(1).optional(),
  PULL_CHECKS_PER_SP_PER_HOUR: Joi.number().min(0.001).max(20).optional(),
  PULL_CHECK_JOB_TIMEOUT_SECONDS: Joi.number().min(60).optional(),
  PULL_CHECK_POLL_INTERVAL_SECONDS: Joi.number().min(1).optional(),
  PULL_CHECK_PIECE_SIZE_BYTES: Joi.number().integer().min(1024).optional(),
  PULL_PIECE_CLEANUP_INTERVAL_SECONDS: Joi.number().integer().min(3600).optional(),
});

/**
 * Returns the Joi field rules for a single network prefix (e.g. `"CALIBRATION"`),
 * keyed by `<PREFIX>_<KEY>`. Active-network enforcement (required wallet, wallet
 * key `.or()`) is applied in `createConfigValidationSchema`.
 */
export const createPerNetworkEnvSchema = (prefix: Uppercase<Network>): Record<string, Joi.Schema> =>
  Object.fromEntries(Object.entries(perNetworkFieldRules()).map(([key, rule]) => [`${prefix}_${key}`, rule]));

/**
 * Bare (unprefixed) shared overrides for inheritable vars. Registered once
 * globally so a shared value (e.g. `DEAL_JOB_TIMEOUT_SECONDS`) is validated with
 * the same rule as its prefixed override, not waved through by `allowUnknown`.
 * `.strip()` keeps the value out of the validated output so it is never assigned
 * back into `process.env`; the loader reads the operator's original value.
 */
export const createSharedNetworkEnvSchema = (): Record<string, Joi.Schema> => {
  const rules = perNetworkFieldRules();
  return Object.fromEntries(
    INHERITABLE_NETWORK_VARS.map((key) => [key, (rules[key] as Joi.AnySchema).optional().strip()]),
  );
};

// ---------------------------------------------------------------------------
// Dynamic schema factory
// ---------------------------------------------------------------------------

/**
 * Builds the full Joi validation schema, adapting per-network field
 * requirements to which networks are present in `processEnv.NETWORKS`.
 */
export function createConfigValidationSchema(processEnv: NodeJS.ProcessEnv = process.env): Joi.ObjectSchema {
  const activeNetworks = parseActiveNetworks(processEnv);

  const schemaFields: Record<string, Joi.Schema> = {
    ...appEnvSchema,
    ...databaseEnvSchema,
    ...globalNetworkEnvSchema,
    ...jobsEnvSchema,
    ...clickhouseEnvSchema,
    ...pullPieceEnvSchema,
    ...datasetEnvSchema,
    ...timeoutEnvSchema,
    ...retrievalEnvSchema,
    // Unprefixed shared overrides for inheritable per-network vars, validated once.
    ...createSharedNetworkEnvSchema(),
  };

  const walletKeyOrConditions: [string, string][] = [];

  for (const prefix of NETWORK_ENV_PREFIXES) {
    const networkRules = createPerNetworkEnvSchema(prefix);

    if (activeNetworks.includes(prefix.toLowerCase() as Network)) {
      Object.assign(schemaFields, networkRules);
      walletKeyOrConditions.push([`${prefix}_WALLET_PRIVATE_KEY`, `${prefix}_SESSION_KEY_PRIVATE_KEY`]);
    } else {
      const optionalRules = Object.fromEntries(
        Object.entries(networkRules).map(([key, rule]) => [key, (rule as Joi.AnySchema).optional()]),
      );
      Object.assign(schemaFields, optionalRules);
    }
  }

  let schema = Joi.object(schemaFields);

  for (const [walletKey, sessionKey] of walletKeyOrConditions) {
    schema = schema.or(walletKey, sessionKey);
  }

  return schema;
}

// ---------------------------------------------------------------------------
// NestJS ConfigModule `validate` callback
// ---------------------------------------------------------------------------

/**
 * Entry point wired into `ConfigModule.forRoot({ validate })`. Runs AFTER
 * `@nestjs/config` has merged `.env` into the env object, so the scheme
 * detector sees the operator's real configuration.
 */
export function validateConfig(rawEnv: Record<string, unknown>): Record<string, unknown> {
  logLegacyEnvCompatResult(applyLegacyEnvCompat(rawEnv as NodeJS.ProcessEnv));

  const schema = createConfigValidationSchema(rawEnv as NodeJS.ProcessEnv);
  const { error, value } = schema.validate(rawEnv, { allowUnknown: true, abortEarly: false });
  if (error) {
    throw new Error(`Config validation error: ${error.message}`);
  }
  return value;
}
