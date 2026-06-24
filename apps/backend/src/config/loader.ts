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
import { coerceBoolean, coerceFloat, coerceNumber, getBooleanEnv, getNumberEnv, getStringEnv } from "./env.helpers.js";
import {
  parseActiveNetworks,
  parseAddressList,
  parseIdList,
  parseRandomDatasetSizes,
  parseRunMode,
} from "./env.parsers.js";
import { inheritsUnprefixed, type PerNetworkVar } from "./network-fields.js";
import type {
  BaseNetworkConfig,
  IAppConfig,
  IClickhouseConfig,
  IConfig,
  IDatabaseConfig,
  IDatasetConfig,
  IJobsConfig,
  INetworkConfig,
  IPullPieceConfig,
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
  apiPublicUrl: env.DEALBOT_API_PUBLIC_URL || undefined,
  metricsPort: getNumberEnv(env, "DEALBOT_METRICS_PORT", 9090),
  metricsHost: getStringEnv(env, "DEALBOT_METRICS_HOST", "0.0.0.0"),
  enableDevMode: env.ENABLE_DEV_MODE === "true",
  prometheusWalletBalanceTtlSeconds: getNumberEnv(env, "PROMETHEUS_WALLET_BALANCE_TTL_SECONDS", 3600),
  prometheusWalletBalanceErrorCooldownSeconds: getNumberEnv(
    env,
    "PROMETHEUS_WALLET_BALANCE_ERROR_COOLDOWN_SECONDS",
    60,
  ),
  probeLocation: getStringEnv(env, "DEALBOT_PROBE_LOCATION", "unknown"),
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
  shutdownFinalScrapeDelaySeconds: getNumberEnv(env, "SHUTDOWN_FINAL_SCRAPE_DELAY_SECONDS", 35),
});

const loadClickhouseConfig = (env: NodeJS.ProcessEnv): IClickhouseConfig => ({
  url: env.CLICKHOUSE_URL || undefined,
  batchSize: getNumberEnv(env, "CLICKHOUSE_BATCH_SIZE", 500),
  flushIntervalMs: getNumberEnv(env, "CLICKHOUSE_FLUSH_INTERVAL_MS", 5000),
  maxBufferSize: getNumberEnv(env, "CLICKHOUSE_MAX_BUFFER_SIZE", 5000),
});

const loadPullPieceConfig = (env: NodeJS.ProcessEnv): IPullPieceConfig => ({
  maxConcurrentStreams: getNumberEnv(env, "PULL_PIECE_MAX_CONCURRENT_STREAMS", 50),
  maxStreamsPerCid: getNumberEnv(env, "PULL_PIECE_MAX_STREAMS_PER_CID", 3),
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
 * Inheritable vars resolve with precedence `<PREFIX>_<KEY>` → unprefixed `<KEY>`
 * → default, so a shared value can be set once and overridden per network.
 * Chain-specific vars (see `network-fields.ts`) read the prefixed slot only.
 * Legacy unprefixed single-network envs are translated to the prefixed form by
 * `applyLegacyEnvCompat` before `loadConfig` runs.
 */
function loadNetworkEnvPrefix(
  prefix: Uppercase<Network>,
  env: NodeJS.ProcessEnv,
): DistributiveOmit<INetworkConfig, "network"> {
  const network = prefix.toLowerCase() as Network;

  // Resolve one per-network var: prefixed override wins, inheritable vars then
  // fall back to the unprefixed shared slot, else undefined (caller defaults).
  const resolve = (key: PerNetworkVar): string | undefined => {
    const prefixed = env[`${prefix}_${key}`];
    if (prefixed) return prefixed;
    if (inheritsUnprefixed(key)) {
      const shared = env[key];
      if (shared) return shared;
    }
    return undefined;
  };

  const base = {
    walletAddress: resolve("WALLET_ADDRESS") ?? ZERO_ADDRESS,
    rpcUrl: resolve("RPC_URL"),
    rpcRequestTimeoutMs: coerceNumber(resolve("RPC_REQUEST_TIMEOUT_MS"), networkDefaults.rpcRequestTimeoutMs),
    pdpSubgraphEndpoint: resolve("PDP_SUBGRAPH_ENDPOINT"),
    checkDatasetCreationFees: coerceBoolean(
      resolve("CHECK_DATASET_CREATION_FEES"),
      networkDefaults.checkDatasetCreationFees,
    ),
    useOnlyApprovedProviders: coerceBoolean(
      resolve("USE_ONLY_APPROVED_PROVIDERS"),
      networkDefaults.useOnlyApprovedProviders,
    ),
    dealbotDataSetVersion: resolve("DEALBOT_DATASET_VERSION"),
    minNumDataSetsForChecks: coerceNumber(
      resolve("MIN_NUM_DATASETS_FOR_CHECKS"),
      networkDefaults.minNumDataSetsForChecks,
    ),
    dealsPerSpPerHour: coerceFloat(resolve("DEALS_PER_SP_PER_HOUR"), networkDefaults.dealsPerSpPerHour),
    dealJobTimeoutSeconds: coerceNumber(resolve("DEAL_JOB_TIMEOUT_SECONDS"), networkDefaults.dealJobTimeoutSeconds),
    retrievalsPerSpPerHour: coerceFloat(resolve("RETRIEVALS_PER_SP_PER_HOUR"), networkDefaults.retrievalsPerSpPerHour),
    retrievalJobTimeoutSeconds: coerceNumber(
      resolve("RETRIEVAL_JOB_TIMEOUT_SECONDS"),
      networkDefaults.retrievalJobTimeoutSeconds,
    ),
    dataSetCreationsPerSpPerHour: coerceFloat(
      resolve("DATASET_CREATIONS_PER_SP_PER_HOUR"),
      networkDefaults.dataSetCreationsPerSpPerHour,
    ),
    dataSetCreationJobTimeoutSeconds: coerceNumber(
      resolve("DATA_SET_CREATION_JOB_TIMEOUT_SECONDS"),
      networkDefaults.dataSetCreationJobTimeoutSeconds,
    ),
    // Network-dependent default: enabled on every network except mainnet.
    dataSetLifecycleCheckEnabled: coerceBoolean(resolve("DATASET_LIFECYCLE_CHECK_ENABLED"), network !== "mainnet"),
    dataSetLifecycleChecksPerSpPerHour: coerceFloat(
      resolve("DATASET_LIFECYCLE_CHECKS_PER_SP_PER_HOUR"),
      networkDefaults.dataSetLifecycleChecksPerSpPerHour,
    ),
    dataSetLifecycleCheckJobTimeoutSeconds: coerceNumber(
      resolve("DATA_SET_LIFECYCLE_CHECK_JOB_TIMEOUT_SECONDS"),
      networkDefaults.dataSetLifecycleCheckJobTimeoutSeconds,
    ),
    dataRetentionPollIntervalSeconds: coerceNumber(
      resolve("DATA_RETENTION_POLL_INTERVAL_SECONDS"),
      networkDefaults.dataRetentionPollIntervalSeconds,
    ),
    providersRefreshIntervalSeconds: coerceNumber(
      resolve("PROVIDERS_REFRESH_INTERVAL_SECONDS"),
      networkDefaults.providersRefreshIntervalSeconds,
    ),
    pieceCleanupPerSpPerHour: coerceFloat(
      resolve("PIECE_CLEANUP_PER_SP_PER_HOUR"),
      networkDefaults.pieceCleanupPerSpPerHour,
    ),
    maxPieceCleanupRuntimeSeconds: coerceNumber(
      resolve("MAX_PIECE_CLEANUP_RUNTIME_SECONDS"),
      networkDefaults.maxPieceCleanupRuntimeSeconds,
    ),
    maxDatasetStorageSizeBytes: coerceNumber(
      resolve("MAX_DATASET_STORAGE_SIZE_BYTES"),
      networkDefaults.maxDatasetStorageSizeBytes,
    ),
    targetDatasetStorageSizeBytes: coerceNumber(
      resolve("TARGET_DATASET_STORAGE_SIZE_BYTES"),
      networkDefaults.targetDatasetStorageSizeBytes,
    ),

    maintenanceWindowsUtc: ((raw) =>
      raw
        ? raw
            .split(",")
            .map((v) => v.trim())
            .filter((v) => v.length > 0)
        : networkDefaults.maintenanceWindowsUtc)(resolve("MAINTENANCE_WINDOWS_UTC")),
    maintenanceWindowMinutes: coerceNumber(
      resolve("MAINTENANCE_WINDOW_MINUTES"),
      networkDefaults.maintenanceWindowMinutes,
    ),

    blockedSpIds: parseIdList(resolve("BLOCKED_SP_IDS")),
    blockedSpAddresses: parseAddressList(resolve("BLOCKED_SP_ADDRESSES")),

    pullChecksPerSpPerHour: coerceFloat(resolve("PULL_CHECKS_PER_SP_PER_HOUR"), networkDefaults.pullChecksPerSpPerHour),
    pullCheckJobTimeoutSeconds: coerceNumber(
      resolve("PULL_CHECK_JOB_TIMEOUT_SECONDS"),
      networkDefaults.pullCheckJobTimeoutSeconds,
    ),
    pullCheckPollIntervalSeconds: coerceNumber(
      resolve("PULL_CHECK_POLL_INTERVAL_SECONDS"),
      networkDefaults.pullCheckPollIntervalSeconds,
    ),
    pullCheckPieceSizeBytes: coerceNumber(
      resolve("PULL_CHECK_PIECE_SIZE_BYTES"),
      networkDefaults.pullCheckPieceSizeBytes,
    ),
    pullPieceCleanupIntervalSeconds: coerceNumber(
      resolve("PULL_PIECE_CLEANUP_INTERVAL_SECONDS"),
      networkDefaults.pullPieceCleanupIntervalSeconds,
    ),
  } satisfies Omit<BaseNetworkConfig, "network">;

  const walletPrivateKey = resolve("WALLET_PRIVATE_KEY") as `0x${string}` | undefined;
  const sessionKeyPrivateKey = resolve("SESSION_KEY_PRIVATE_KEY") as `0x${string}` | undefined;

  if (sessionKeyPrivateKey) return { ...base, sessionKeyPrivateKey };
  if (walletPrivateKey) return { ...base, walletPrivateKey };

  // Joi's .or() constraint on `${prefix}_WALLET_PRIVATE_KEY` /
  // `${prefix}_SESSION_KEY_PRIVATE_KEY` ensures this branch is unreachable
  throw new Error(`[config] Neither WALLET_PRIVATE_KEY nor SESSION_KEY_PRIVATE_KEY is set for ${prefix}`);
}

const loadNetworkConfigs = (env: NodeJS.ProcessEnv): Pick<IConfig, "networks" | "activeNetworks"> => {
  const activeNetworks = parseActiveNetworks(env);
  if (activeNetworks.length === 0) {
    // parseActiveNetworks already falls back to a default network for an absent
    // NETWORKS; reaching here means NETWORKS was set but resolved to nothing
    // (e.g. whitespace/commas). Fail fast rather than boot an idle process.
    throw new Error("[config] NETWORKS resolved to no supported networks. Set NETWORKS to a comma-separated list.");
  }
  const networks = {} as Record<Network, INetworkConfig>;

  for (const network of activeNetworks) {
    const prefix = network.toUpperCase() as Uppercase<Network>;
    const networkConfig: INetworkConfig = { network, ...loadNetworkEnvPrefix(prefix, env) };
    // Cross-field invariant: the eviction target must sit below the hard cap, or
    // piece cleanup has no headroom to act. Asserted post-resolution because the
    // two values can come from different precedence tiers (override vs shared).
    if (networkConfig.targetDatasetStorageSizeBytes >= networkConfig.maxDatasetStorageSizeBytes) {
      throw new Error(
        `[config] ${network}: TARGET_DATASET_STORAGE_SIZE_BYTES (${networkConfig.targetDatasetStorageSizeBytes}) ` +
          `must be less than MAX_DATASET_STORAGE_SIZE_BYTES (${networkConfig.maxDatasetStorageSizeBytes})`,
      );
    }
    networks[network] = networkConfig;
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
    clickhouse: loadClickhouseConfig(process.env),
    pullPiece: loadPullPieceConfig(process.env),
    dataset: loadDatasetConfig(process.env),
    timeouts: loadTimeoutConfig(process.env),
    retrieval: loadRetrievalConfig(process.env),
  };
}
