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

// ---------------------------------------------------------------------------
// Custom Joi validators
// ---------------------------------------------------------------------------

const validateNetworksEnv = (value: string, helpers: Joi.CustomHelpers) => {
  const parts = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const part of parts) {
    if (!SUPPORTED_NETWORKS.includes(part as Network)) {
      return helpers.error("any.invalid", {
        message: `Invalid network "${part}". Supported: ${SUPPORTED_NETWORKS.join(", ")}.`,
      });
    }
  }

  return parts.length === 0 ? SUPPORTED_NETWORKS[0] : value;
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
  DEALBOT_METRICS_PORT: Joi.number().default(9090),
  DEALBOT_METRICS_HOST: Joi.string().default("0.0.0.0"),
  ENABLE_DEV_MODE: Joi.boolean().default(false),
  PROMETHEUS_WALLET_BALANCE_TTL_SECONDS: Joi.number().min(60).default(3600),
  PROMETHEUS_WALLET_BALANCE_ERROR_COOLDOWN_SECONDS: Joi.number().min(1).default(60),
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
  DEAL_JOB_TIMEOUT_SECONDS: Joi.number().min(120).default(360),
  RETRIEVAL_JOB_TIMEOUT_SECONDS: Joi.number().min(60).default(60),
  DATA_SET_CREATION_JOB_TIMEOUT_SECONDS: Joi.number().min(60).default(300),
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
 * Returns the Joi field rules for a single network prefix (e.g. `"CALIBRATION"`).
 * Fields are defined as optional here; active-network enforcement is handled
 * in `createConfigValidationSchema`.
 */
export const createPerNetworkEnvSchema = (prefix: Uppercase<Network> | "") => {
  const k = (key: string) => `${prefix}_${key}`;
  return {
    [k("WALLET_ADDRESS")]: Joi.string().required(),
    [k("WALLET_PRIVATE_KEY")]: Joi.string().optional().empty(""),
    [k("SESSION_KEY_PRIVATE_KEY")]: Joi.string().optional().empty(""),
    [k("RPC_URL")]: Joi.string()
      .uri({ scheme: ["http", "https"] })
      .optional()
      .allow(""),
    [k("PDP_SUBGRAPH_ENDPOINT")]: Joi.string().uri().optional().allow(""),
    [k("CHECK_DATASET_CREATION_FEES")]: Joi.boolean().optional(),
    [k("USE_ONLY_APPROVED_PROVIDERS")]: Joi.boolean().optional(),
    [k("DEALBOT_DATASET_VERSION")]: Joi.string().optional(),
    [k("MIN_NUM_DATASETS_FOR_CHECKS")]: Joi.number().integer().min(1).optional(),
    [k("METRICS_PER_HOUR")]: Joi.number().min(0.001).max(3).optional(),
    [k("DEALS_PER_SP_PER_HOUR")]: Joi.number().min(0.001).max(20).optional(),
    [k("RETRIEVALS_PER_SP_PER_HOUR")]: Joi.number().min(0.001).max(20).optional(),
    [k("DATASET_CREATIONS_PER_SP_PER_HOUR")]: Joi.number().min(0.001).max(20).optional(),
    [k("DATA_RETENTION_POLL_INTERVAL_SECONDS")]: Joi.number().optional(),
    [k("PROVIDERS_REFRESH_INTERVAL_SECONDS")]: Joi.number().optional(),
    [k("MAINTENANCE_WINDOWS_UTC")]: Joi.string().default("07:00,22:00").custom(validateMaintenanceWindowsEnv),
    [k("MAINTENANCE_WINDOW_MINUTES")]: Joi.number().min(20).max(360).default(20),
    [k("BLOCKED_SP_IDS")]: Joi.string().optional().allow(""),
    [k("BLOCKED_SP_ADDRESSES")]: Joi.string().optional().allow(""),

    [k("PIECE_CLEANUP_PER_SP_PER_HOUR")]: Joi.number()
      .min(0.001)
      .max(20)
      .default(1 / 24),
    [k("MAX_PIECE_CLEANUP_RUNTIME_SECONDS")]: Joi.number().min(60).default(300),
    [k("MAX_DATASET_STORAGE_SIZE_BYTES")]: Joi.number()
      .integer()
      .min(1)
      .default(24 * 1024 * 1024 * 1024),
    [k("TARGET_DATASET_STORAGE_SIZE_BYTES")]: Joi.number()
      .integer()
      .min(1)
      .default(20 * 1024 * 1024 * 1024) // 20 GiB per SP
      .custom((value, helpers) => {
        const max = helpers.state.ancestors?.[0]?.MAX_DATASET_STORAGE_SIZE_BYTES;
        if (max != null && value >= max) {
          return helpers.error("any.invalid", {
            message: `TARGET_DATASET_STORAGE_SIZE_BYTES (${value}) must be less than MAX_DATASET_STORAGE_SIZE_BYTES (${max})`,
          });
        }
        return value;
      }, "target < max validation"),
  };
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
    ...datasetEnvSchema,
    ...timeoutEnvSchema,
    ...retrievalEnvSchema,
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
