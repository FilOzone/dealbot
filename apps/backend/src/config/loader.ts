/**
 * Configuration loaders.
 *
 * Each `load*Config` function reads `process.env` (or an injected map) and
 * returns a fully-typed config slice.  `loadConfig` assembles all slices into
 * the top-level `IConfig` object consumed by NestJS `ConfigModule`.
 *
 */

import { DEFAULT_LOCAL_DATASETS_PATH, ZERO_ADDRESS } from "../common/constants.js";
import type { Network } from "../common/types.js";
import { networkDefaults } from "./constants.js";
import { getBooleanEnv, getFloatEnv, getNumberEnv, getStringEnv } from "./env.helpers.js";
import {
  parseActiveNetworks,
  parseAddressList,
  parseIdList,
  parseRandomDatasetSizes,
  parseRunMode,
} from "./env.parsers.js";
import type {
  IAppConfig,
  IConfig,
  IDatabaseConfig,
  IDatasetConfig,
  IJobsConfig,
  INetworkConfig,
  IRetrievalConfig,
  ITimeoutConfig,
} from "./types.js";

// ---------------------------------------------------------------------------
// Per-section loaders
// ---------------------------------------------------------------------------

const loadAppConfig = (env: NodeJS.ProcessEnv): IAppConfig => ({
  env: getStringEnv(env, "NODE_ENV", "development"),
  runMode: parseRunMode(env),
  port: getNumberEnv(env, "DEALBOT_PORT", 3000),
  host: getStringEnv(env, "DEALBOT_HOST", "127.0.0.1"),
  metricsPort: getNumberEnv(env, "DEALBOT_METRICS_PORT", 9090),
  metricsHost: getStringEnv(env, "DEALBOT_METRICS_HOST", "0.0.0.0"),
  enableDevMode: env.ENABLE_DEV_MODE === "true",
  prometheusWalletBalanceTtlSeconds: getNumberEnv(env, "PROMETHEUS_WALLET_BALANCE_TTL_SECONDS", 3600),
  prometheusWalletBalanceErrorCooldownSeconds: getNumberEnv(
    env,
    "PROMETHEUS_WALLET_BALANCE_ERROR_COOLDOWN_SECONDS",
    60,
  ),
});

const loadDatabaseConfig = (env: NodeJS.ProcessEnv): IDatabaseConfig => ({
  host: getStringEnv(env, "DATABASE_HOST", "localhost"),
  port: getNumberEnv(env, "DATABASE_PORT", 5432),
  poolMax: getNumberEnv(env, "DATABASE_POOL_MAX", 1),
  username: getStringEnv(env, "DATABASE_USER", "dealbot"),
  password: getStringEnv(env, "DATABASE_PASSWORD", "dealbot_password"),
  database: getStringEnv(env, "DATABASE_NAME", "filecoin_dealbot"),
});

const loadJobsConfig = (env: NodeJS.ProcessEnv): IJobsConfig => ({
  schedulerPollSeconds: getNumberEnv(env, "JOB_SCHEDULER_POLL_SECONDS", 300),
  workerPollSeconds: getNumberEnv(env, "JOB_WORKER_POLL_SECONDS", 60),
  pgbossLocalConcurrency: getNumberEnv(env, "PG_BOSS_LOCAL_CONCURRENCY", 20),
  pgbossSchedulerEnabled: getBooleanEnv(env, "DEALBOT_PGBOSS_SCHEDULER_ENABLED", true),
  pgbossPoolMax: getNumberEnv(env, "DEALBOT_PGBOSS_POOL_MAX", 1),
  catchupMaxEnqueue: getNumberEnv(env, "JOB_CATCHUP_MAX_ENQUEUE", 10),
  schedulePhaseSeconds: getNumberEnv(env, "JOB_SCHEDULE_PHASE_SECONDS", 0),
  enqueueJitterSeconds: getNumberEnv(env, "JOB_ENQUEUE_JITTER_SECONDS", 0),
  dealJobTimeoutSeconds: getNumberEnv(env, "DEAL_JOB_TIMEOUT_SECONDS", 360),
  retrievalJobTimeoutSeconds: getNumberEnv(env, "RETRIEVAL_JOB_TIMEOUT_SECONDS", 60),
  dataSetCreationJobTimeoutSeconds: getNumberEnv(env, "DATA_SET_CREATION_JOB_TIMEOUT_SECONDS", 300),
});

const loadDatasetConfig = (env: NodeJS.ProcessEnv): IDatasetConfig => ({
  localDatasetsPath: getStringEnv(env, "DEALBOT_LOCAL_DATASETS_PATH", DEFAULT_LOCAL_DATASETS_PATH),
  randomDatasetSizes: parseRandomDatasetSizes(env),
});

const loadTimeoutConfig = (env: NodeJS.ProcessEnv): ITimeoutConfig => ({
  connectTimeoutMs: getNumberEnv(env, "CONNECT_TIMEOUT_MS", 10000),
  httpRequestTimeoutMs: getNumberEnv(env, "HTTP_REQUEST_TIMEOUT_MS", 240000),
  http2RequestTimeoutMs: getNumberEnv(env, "HTTP2_REQUEST_TIMEOUT_MS", 240000),
  ipniVerificationTimeoutMs: getNumberEnv(env, "IPNI_VERIFICATION_TIMEOUT_MS", 60000),
  ipniVerificationPollingMs: getNumberEnv(env, "IPNI_VERIFICATION_POLLING_MS", 2000),
});

const loadRetrievalConfig = (env: NodeJS.ProcessEnv): IRetrievalConfig => ({
  ipfsBlockFetchConcurrency: getNumberEnv(env, "IPFS_BLOCK_FETCH_CONCURRENCY", 6),
});

// ---------------------------------------------------------------------------
// Per-network loader
// ---------------------------------------------------------------------------

type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

/**
 * Reads all per-network env vars for one network's prefix
 * (e.g. `"CALIBRATION"` → reads `CALIBRATION_RPC_URL`, `CALIBRATION_WALLET_ADDRESS`, ...).
 *
 * Legacy (unprefixed) envs are translated to this prefixed form by
 * `applyLegacyEnvCompat` before `loadConfig` runs, so this function only
 * needs to handle the prefixed scheme.
 */
function loadNetworkEnvPrefix(
  prefix: Uppercase<Network>,
  env: NodeJS.ProcessEnv,
): DistributiveOmit<INetworkConfig, "network"> {
  const k = (key: string) => `${prefix}_${key}`;
  const get = (key: string) => env[k(key)];

  const base = {
    walletAddress: get("WALLET_ADDRESS") || ZERO_ADDRESS,
    rpcUrl: get("RPC_URL") || undefined,
    pdpSubgraphEndpoint: get("PDP_SUBGRAPH_ENDPOINT") || "",
    checkDatasetCreationFees: getBooleanEnv(
      env,
      k("CHECK_DATASET_CREATION_FEES"),
      networkDefaults.checkDatasetCreationFees,
    ),
    useOnlyApprovedProviders: getBooleanEnv(
      env,
      k("USE_ONLY_APPROVED_PROVIDERS"),
      networkDefaults.useOnlyApprovedProviders,
    ),
    dealbotDataSetVersion: get("DEALBOT_DATASET_VERSION") || undefined,
    minNumDataSetsForChecks: getNumberEnv(
      env,
      k("MIN_NUM_DATASETS_FOR_CHECKS"),
      networkDefaults.minNumDataSetsForChecks,
    ),
    dealsPerSpPerHour: getFloatEnv(env, k("DEALS_PER_SP_PER_HOUR"), networkDefaults.dealsPerSpPerHour),
    retrievalsPerSpPerHour: getFloatEnv(env, k("RETRIEVALS_PER_SP_PER_HOUR"), networkDefaults.retrievalsPerSpPerHour),
    dataSetCreationsPerSpPerHour: getFloatEnv(
      env,
      k("DATASET_CREATIONS_PER_SP_PER_HOUR"),
      networkDefaults.dataSetCreationsPerSpPerHour,
    ),
    dataRetentionPollIntervalSeconds: getNumberEnv(
      env,
      k("DATA_RETENTION_POLL_INTERVAL_SECONDS"),
      networkDefaults.dataRetentionPollIntervalSeconds,
    ),
    providersRefreshIntervalSeconds: getNumberEnv(
      env,
      k("PROVIDERS_REFRESH_INTERVAL_SECONDS"),
      networkDefaults.providersRefreshIntervalSeconds,
    ),
    maintenanceWindowsUtc: get("MAINTENANCE_WINDOWS_UTC")
      ? get("MAINTENANCE_WINDOWS_UTC")!
          .split(",")
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
      : networkDefaults.maintenanceWindowsUtc,
    maintenanceWindowMinutes: getNumberEnv(
      env,
      k("MAINTENANCE_WINDOW_MINUTES"),
      networkDefaults.maintenanceWindowMinutes,
    ),
    blockedSpIds: parseIdList(get("BLOCKED_SP_IDS")),
    blockedSpAddresses: parseAddressList(get("BLOCKED_SP_ADDRESSES")),
    pieceCleanupPerSpPerHour: getFloatEnv(
      env,
      k("PIECE_CLEANUP_PER_SP_PER_HOUR"),
      networkDefaults.pieceCleanupPerSpPerHour,
    ),
    maxPieceCleanupRuntimeSeconds: getNumberEnv(
      env,
      k("MAX_PIECE_CLEANUP_RUNTIME_SECONDS"),
      networkDefaults.maxPieceCleanupRuntimeSeconds,
    ),
    maxDatasetStorageSizeBytes: getNumberEnv(
      env,
      k("MAX_DATASET_STORAGE_SIZE_BYTES"),
      networkDefaults.maxDatasetStorageSizeBytes,
    ),
    targetDatasetStorageSizeBytes: getNumberEnv(
      env,
      k("TARGET_DATASET_STORAGE_SIZE_BYTES"),
      networkDefaults.targetDatasetStorageSizeBytes,
    ),
  };

  const walletPrivateKey = (get("WALLET_PRIVATE_KEY") || undefined) as `0x${string}` | undefined;
  const sessionKeyPrivateKey = (get("SESSION_KEY_PRIVATE_KEY") || undefined) as `0x${string}` | undefined;

  if (sessionKeyPrivateKey) return { ...base, sessionKeyPrivateKey };
  if (walletPrivateKey) return { ...base, walletPrivateKey };

  // Joi's .or() constraint on `${prefix}_WALLET_PRIVATE_KEY` /
  // `${prefix}_SESSION_KEY_PRIVATE_KEY` ensures this branch is unreachable
  throw new Error(`[config] Neither WALLET_PRIVATE_KEY nor SESSION_KEY_PRIVATE_KEY is set for ${prefix}`);
}

const loadNetworkConfigs = (env: NodeJS.ProcessEnv): Pick<IConfig, "networks" | "activeNetworks"> => {
  const activeNetworks = parseActiveNetworks(env);
  const networks = {} as Record<Network, INetworkConfig>;

  for (const network of activeNetworks) {
    const prefix = network.toUpperCase() as Uppercase<Network>;
    networks[network] = { network, ...loadNetworkEnvPrefix(prefix, env) };
  }

  return { networks, activeNetworks };
};

// ---------------------------------------------------------------------------
// Top-level loader (NestJS ConfigModule entry-point)
// ---------------------------------------------------------------------------

export function loadConfig(): IConfig {
  return {
    app: loadAppConfig(process.env),
    database: loadDatabaseConfig(process.env),
    ...loadNetworkConfigs(process.env),
    jobs: loadJobsConfig(process.env),
    dataset: loadDatasetConfig(process.env),
    timeouts: loadTimeoutConfig(process.env),
    retrieval: loadRetrievalConfig(process.env),
  };
}
