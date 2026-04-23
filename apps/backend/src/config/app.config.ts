import Joi from "joi";
import { DEFAULT_LOCAL_DATASETS_PATH } from "../common/constants.js";
import { parseMaintenanceWindowTimes } from "../common/maintenance-window.js";
import type { Network } from "../common/types.js";

function parseIdList(value: string | undefined): Set<string> {
  if (!value || value.trim().length === 0) return new Set();
  return new Set(
    value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

function parseAddressList(value: string | undefined): Set<string> {
  if (!value || value.trim().length === 0) return new Set();
  return new Set(
    value
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
}

export const configValidationSchema = Joi.object({
  // Application
  NODE_ENV: Joi.string().valid("development", "production", "test").default("development"),
  DEALBOT_RUN_MODE: Joi.string().lowercase().valid("api", "worker", "both").default("both"),
  DEALBOT_PORT: Joi.number().default(3000),
  DEALBOT_HOST: Joi.string().default("127.0.0.1"),
  DEALBOT_METRICS_PORT: Joi.number().default(9090),
  DEALBOT_METRICS_HOST: Joi.string().default("0.0.0.0"),
  ENABLE_DEV_MODE: Joi.boolean().default(false),
  PROMETHEUS_WALLET_BALANCE_TTL_SECONDS: Joi.number().min(60).default(3600),
  PROMETHEUS_WALLET_BALANCE_ERROR_COOLDOWN_SECONDS: Joi.number().min(1).default(60),

  // Database
  DATABASE_HOST: Joi.string().required(),
  DATABASE_PORT: Joi.number().default(5432),
  DATABASE_POOL_MAX: Joi.number().integer().min(1).default(1),
  DATABASE_USER: Joi.string().required(),
  DATABASE_PASSWORD: Joi.string().required(),
  DATABASE_NAME: Joi.string().required(),

  // Blockchain
  NETWORK: Joi.string().valid("mainnet", "calibration").default("calibration"),
  WALLET_ADDRESS: Joi.string().required(),
  WALLET_PRIVATE_KEY: Joi.string().optional().empty(""),
  RPC_URL: Joi.string()
    .uri({ scheme: ["http", "https"] })
    .optional()
    .allow(""),
  SESSION_KEY_PRIVATE_KEY: Joi.string().optional().empty(""),
  CHECK_DATASET_CREATION_FEES: Joi.boolean().default(true),
  USE_ONLY_APPROVED_PROVIDERS: Joi.boolean().default(true),
  DEALBOT_DATASET_VERSION: Joi.string().optional(),
  MIN_NUM_DATASETS_FOR_CHECKS: Joi.number().integer().min(1).default(1),
  SUBGRAPH_ENDPOINT: Joi.string().uri().optional().allow(""),

  // Scheduling
  PROVIDERS_REFRESH_INTERVAL_SECONDS: Joi.number().default(4 * 3600),
  DATA_RETENTION_POLL_INTERVAL_SECONDS: Joi.number().default(3600),
  DEALBOT_MAINTENANCE_WINDOWS_UTC: Joi.string()
    .default("07:00,22:00")
    .custom((value, helpers) => {
      try {
        parseMaintenanceWindowTimes(value.split(","));
      } catch (error) {
        return helpers.error("any.invalid", {
          message: error instanceof Error ? error.message : "Invalid maintenance window format",
        });
      }
      return value;
    }),
  DEALBOT_MAINTENANCE_WINDOW_MINUTES: Joi.number().min(20).max(360).default(20),

  // Jobs
  // Per-hour limits are guardrails to avoid excessive background load.
  DEALS_PER_SP_PER_HOUR: Joi.number().min(0.001).max(20).default(4),
  DATASET_CREATIONS_PER_SP_PER_HOUR: Joi.number().min(0.001).max(20).default(1),
  RETRIEVALS_PER_SP_PER_HOUR: Joi.number().min(0.001).max(20).default(2),
  RETRIEVALS_ANON_PER_SP_PER_HOUR: Joi.number().min(0.001).max(20).optional(),
  // Polling interval for pg-boss scheduler (lower = more responsive, higher = less DB chatter).
  JOB_SCHEDULER_POLL_SECONDS: Joi.number().min(60).default(300),
  JOB_WORKER_POLL_SECONDS: Joi.number().min(5).default(60),
  PG_BOSS_LOCAL_CONCURRENCY: Joi.number().integer().min(1).default(20),
  DEALBOT_PGBOSS_SCHEDULER_ENABLED: Joi.boolean().default(true),
  DEALBOT_PGBOSS_POOL_MAX: Joi.number().integer().min(1).default(1),
  JOB_CATCHUP_MAX_ENQUEUE: Joi.number().min(1).default(10),
  JOB_SCHEDULE_PHASE_SECONDS: Joi.number().min(0).default(0),
  JOB_ENQUEUE_JITTER_SECONDS: Joi.number().min(0).default(0),
  DEAL_JOB_TIMEOUT_SECONDS: Joi.number().min(120).default(360), // 6 minutes max runtime for data storage jobs (TODO: reduce default to 3 minutes)
  RETRIEVAL_JOB_TIMEOUT_SECONDS: Joi.number().min(60).default(60), // 1 minute max runtime for retrieval jobs (TODO: reduce default to 30 seconds)
  ANON_RETRIEVAL_JOB_TIMEOUT_SECONDS: Joi.number().min(60).default(360), // 6 minutes max runtime for anon retrieval jobs (pieces can be up to ~70 MiB)
  DATA_SET_CREATION_JOB_TIMEOUT_SECONDS: Joi.number().min(60).default(300), // 5 minutes max runtime for dataset creation jobs
  IPFS_BLOCK_FETCH_CONCURRENCY: Joi.number().integer().min(1).max(32).default(6),
  ANON_RETRIEVAL_BLOCK_SAMPLE_COUNT: Joi.number().integer().min(1).max(50).default(5),

  // Piece Cleanup
  MAX_DATASET_STORAGE_SIZE_BYTES: Joi.number()
    .integer()
    .min(1)
    .default(24 * 1024 * 1024 * 1024), // 24 GiB per SP
  TARGET_DATASET_STORAGE_SIZE_BYTES: Joi.number()
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
  JOB_PIECE_CLEANUP_PER_SP_PER_HOUR: Joi.number()
    .min(0.001)
    .max(20)
    .default(1 / 24), // ~once per day
  MAX_PIECE_CLEANUP_RUNTIME_SECONDS: Joi.number().min(60).default(300), // 5 minutes max runtime for cleanup jobs

  // Dataset
  DEALBOT_LOCAL_DATASETS_PATH: Joi.string().default(DEFAULT_LOCAL_DATASETS_PATH),
  RANDOM_PIECE_SIZES: Joi.string().default("10485760"), // 10 MiB

  // Timeouts (in milliseconds)
  CONNECT_TIMEOUT_MS: Joi.number().min(1000).default(10000), // 10 seconds to establish connection/receive headers
  // Defaults intentionally omitted so loadConfig can derive them from the longest job timeout.
  HTTP_REQUEST_TIMEOUT_MS: Joi.number().min(1000).optional(),
  HTTP2_REQUEST_TIMEOUT_MS: Joi.number().min(1000).optional(),
  IPNI_VERIFICATION_TIMEOUT_MS: Joi.number().min(1000).default(60000), // 60 seconds max time to wait for IPNI verification
  IPNI_VERIFICATION_POLLING_MS: Joi.number().min(250).default(2000), // 2 seconds between IPNI verification polls

  // SP Blocklists (comma-separated provider IDs or addresses)
  BLOCKED_SP_IDS: Joi.string().optional().allow(""),
  BLOCKED_SP_ADDRESSES: Joi.string().optional().allow(""),
}).or("WALLET_PRIVATE_KEY", "SESSION_KEY_PRIVATE_KEY");

export interface IAppConfig {
  env: string;
  runMode: "api" | "worker" | "both";
  port: number;
  host: string;
  metricsPort: number;
  metricsHost: string;
  enableDevMode: boolean;
  prometheusWalletBalanceTtlSeconds: number;
  prometheusWalletBalanceErrorCooldownSeconds: number;
}

export interface IDatabaseConfig {
  host: string;
  port: number;
  poolMax: number;
  username: string;
  password: string;
  database: string;
}

export interface IBlockchainConfig {
  network: Network;
  rpcUrl?: string;
  sessionKeyPrivateKey?: `0x${string}`;
  walletAddress: string;
  walletPrivateKey: `0x${string}`;
  checkDatasetCreationFees: boolean;
  useOnlyApprovedProviders: boolean;
  dealbotDataSetVersion?: string;
  minNumDataSetsForChecks: number;
  subgraphEndpoint?: string;
}

export interface ISchedulingConfig {
  providersRefreshIntervalSeconds: number;
  dataRetentionPollIntervalSeconds: number;
  maintenanceWindowsUtc: string[];
  maintenanceWindowMinutes: number;
}

export interface IJobsConfig {
  /**
   * Target number of deal creations per storage provider per hour.
   *
   * Increasing this increases on-chain activity and dataset uploads.
   */
  dealsPerSpPerHour: number;
  /**
   * Target number of retrieval tests per storage provider per hour.
   *
   * Increasing this increases retrieval load against providers and DB writes.
   */
  retrievalsPerSpPerHour: number;
  /**
   * Target number of dataset creation runs per storage provider per hour.
   */
  dataSetCreationsPerSpPerHour: number;
  /**
   * How often the scheduler polls Postgres for due jobs (seconds).
   *
   * Lower values reduce scheduling latency but increase DB chatter.
   */
  schedulerPollSeconds: number;
  /**
   * How often workers check for new jobs (seconds).
   *
   * Lower values reduce job pickup latency but increase DB chatter.
   */
  workerPollSeconds: number;
  /**
   * Per-instance pg-boss worker concurrency for the `sp.work` queue.
   */
  pgbossLocalConcurrency: number;
  /**
   * Enables the pg-boss scheduler loop (enqueueing due jobs).
   *
   * Set to false to run "worker-only" pods that only process existing jobs.
   */
  pgbossSchedulerEnabled: boolean;
  /**
   * Maximum number of pg-boss connections per instance.
   *
   * Helpful when using a session-mode pooler with a low pool_size (e.g. Supabase).
   */
  pgbossPoolMax: number;
  /**
   * Maximum number of jobs to enqueue per schedule row per poll.
   *
   * Prevents large backlogs from flooding workers after downtime.
   */
  catchupMaxEnqueue: number;
  /**
   * Per-instance phase offset (seconds) applied when initializing schedules.
   *
   * Use this to stagger multiple dealbot deployments that are not sharing a DB.
   */
  schedulePhaseSeconds: number;
  /**
   * Random delay (seconds) added when enqueuing jobs.
   *
   * Helps avoid synchronized bursts across instances. Only used with pg-boss.
   */
  enqueueJitterSeconds: number;
  /**
   * Maximum runtime (seconds) for deal jobs before forced abort.
   *
   * Uses AbortController to actively cancel job execution.
   */
  dealJobTimeoutSeconds: number;
  /**
   * Maximum runtime (seconds) for data-set creation jobs before forced abort.
   *
   * Uses AbortController to actively cancel job execution.
   */
  dataSetCreationJobTimeoutSeconds: number;
  /**
   * Maximum runtime (seconds) for retrieval jobs before forced abort.
   *
   * Uses AbortController to actively cancel job execution.
   */
  retrievalJobTimeoutSeconds: number;
  /**
   * Maximum runtime (seconds) for anonymous retrieval jobs before forced abort.
   *
   * Anonymous retrievals fetch arbitrary pieces (up to ~70 MiB), so this is
   * typically larger than `retrievalJobTimeoutSeconds`. Uses AbortController
   * to actively cancel job execution while still persisting partial metrics.
   */
  anonRetrievalJobTimeoutSeconds: number;
  /**
   * Target number of piece cleanup runs per storage provider per hour.
   *
   * Increasing this makes cleanup more aggressive at the cost of more SP API calls.
   * Only used when `DEALBOT_JOBS_MODE=pgboss`.
   */
  pieceCleanupPerSpPerHour: number;
  /**
   * Maximum runtime (seconds) for piece cleanup jobs before forced abort.
   *
   * Uses AbortController to actively cancel job execution.
   * Only used when `DEALBOT_JOBS_MODE=pgboss`.
   */
  maxPieceCleanupRuntimeSeconds: number;

  /**
   * Target number of anonymous retrieval tests per storage provider per hour.
   * Defaults to retrievalsPerSpPerHour when not set.
   */
  retrievalsAnonPerSpPerHour: number;
}

export interface IDatasetConfig {
  localDatasetsPath: string;
  randomDatasetSizes: number[];
}

export interface ITimeoutConfig {
  connectTimeoutMs: number;
  httpRequestTimeoutMs: number;
  http2RequestTimeoutMs: number;
  ipniVerificationTimeoutMs: number;
  ipniVerificationPollingMs: number;
}

export interface IRetrievalConfig {
  ipfsBlockFetchConcurrency: number;
  /**
   * Number of CAR blocks to sample for IPNI + block-fetch validation.
   */
  anonBlockSampleCount: number;
}

export interface IPieceCleanupConfig {
  maxDatasetStorageSizeBytes: number;
  targetDatasetStorageSizeBytes: number;
}

export interface ISpBlocklistConfig {
  /** Provider numeric IDs to block from all scheduled checks. */
  ids: Set<string>;
  /** Provider addresses to block from all scheduled checks (stored lowercase). */
  addresses: Set<string>;
}

export interface IConfig {
  app: IAppConfig;
  database: IDatabaseConfig;
  blockchain: IBlockchainConfig;
  scheduling: ISchedulingConfig;
  jobs: IJobsConfig;
  dataset: IDatasetConfig;
  timeouts: ITimeoutConfig;
  retrieval: IRetrievalConfig;
  pieceCleanup: IPieceCleanupConfig;
  spBlocklists: ISpBlocklistConfig;
}

export function loadConfig(): IConfig {
  const jobTimeoutSeconds = {
    deal: Number.parseInt(process.env.DEAL_JOB_TIMEOUT_SECONDS || "360", 10),
    retrieval: Number.parseInt(process.env.RETRIEVAL_JOB_TIMEOUT_SECONDS || "60", 10),
    anonRetrieval: Number.parseInt(process.env.ANON_RETRIEVAL_JOB_TIMEOUT_SECONDS || "360", 10),
    dataSetCreation: Number.parseInt(process.env.DATA_SET_CREATION_JOB_TIMEOUT_SECONDS || "300", 10),
    pieceCleanup: Number.parseInt(process.env.MAX_PIECE_CLEANUP_RUNTIME_SECONDS || "300", 10),
  };

  // HTTP-level request timeouts default to the longest job timeout so the
  // per-request ceiling never caps below the per-job budget. Any job-scoped
  // AbortSignal fires first and is authoritative; the HTTP timer only kicks
  // in for callers that do not pass a parent signal.
  const longestJobTimeoutMs = Math.max(...Object.values(jobTimeoutSeconds)) * 1000;

  const httpRequestTimeoutMs = Number.parseInt(process.env.HTTP_REQUEST_TIMEOUT_MS || String(longestJobTimeoutMs), 10);
  const http2RequestTimeoutMs = Number.parseInt(
    process.env.HTTP2_REQUEST_TIMEOUT_MS || String(longestJobTimeoutMs),
    10,
  );

  // Misconfiguration guard: if someone explicitly sets an HTTP timeout below
  // the longest job timeout, the HTTP-level timer will abort in-flight work
  // before the job signal has a chance to report it. Warn loudly so this is
  // caught at boot rather than inferred from short-timeout incidents later.
  for (const [name, value] of [
    ["HTTP_REQUEST_TIMEOUT_MS", httpRequestTimeoutMs],
    ["HTTP2_REQUEST_TIMEOUT_MS", http2RequestTimeoutMs],
  ] as const) {
    if (value < longestJobTimeoutMs) {
      // eslint-disable-next-line no-console
      console.warn(
        `[config] ${name}=${value}ms is lower than the longest job timeout (${longestJobTimeoutMs}ms). ` +
          `HTTP requests may abort before the job signal fires, producing short, unexplained timeouts.`,
      );
    }
  }

  return {
    app: {
      env: process.env.NODE_ENV || "development",
      runMode: (() => {
        const mode = (process.env.DEALBOT_RUN_MODE || "both").toLowerCase();
        if (mode === "worker") return "worker";
        if (mode === "api") return "api";
        return "both";
      })(),
      port: Number.parseInt(process.env.DEALBOT_PORT || "3000", 10),
      host: process.env.DEALBOT_HOST || "127.0.0.1",
      metricsPort: Number.parseInt(process.env.DEALBOT_METRICS_PORT || "9090", 10),
      metricsHost: process.env.DEALBOT_METRICS_HOST || "0.0.0.0",
      enableDevMode: process.env.ENABLE_DEV_MODE === "true",
      prometheusWalletBalanceTtlSeconds: Number.parseInt(
        process.env.PROMETHEUS_WALLET_BALANCE_TTL_SECONDS || "3600",
        10,
      ),
      prometheusWalletBalanceErrorCooldownSeconds: Number.parseInt(
        process.env.PROMETHEUS_WALLET_BALANCE_ERROR_COOLDOWN_SECONDS || "60",
        10,
      ),
    },
    database: {
      host: process.env.DATABASE_HOST || "localhost",
      port: Number.parseInt(process.env.DATABASE_PORT || "5432", 10),
      poolMax: Number.parseInt(process.env.DATABASE_POOL_MAX || "1", 10),
      username: process.env.DATABASE_USER || "dealbot",
      password: process.env.DATABASE_PASSWORD || "dealbot_password",
      database: process.env.DATABASE_NAME || "filecoin_dealbot",
    },
    blockchain: {
      network: (process.env.NETWORK || "calibration") as Network,
      rpcUrl: process.env.RPC_URL || undefined,
      sessionKeyPrivateKey: (process.env.SESSION_KEY_PRIVATE_KEY || undefined) as `0x${string}` | undefined,
      walletAddress: process.env.WALLET_ADDRESS || "0x0000000000000000000000000000000000000000",
      walletPrivateKey: (process.env.WALLET_PRIVATE_KEY || undefined) as `0x${string}`,
      checkDatasetCreationFees: process.env.CHECK_DATASET_CREATION_FEES !== "false",
      useOnlyApprovedProviders: process.env.USE_ONLY_APPROVED_PROVIDERS !== "false",
      dealbotDataSetVersion: process.env.DEALBOT_DATASET_VERSION,
      minNumDataSetsForChecks: Number.parseInt(process.env.MIN_NUM_DATASETS_FOR_CHECKS || "1", 10),
      subgraphEndpoint: process.env.SUBGRAPH_ENDPOINT || "",
    },
    scheduling: {
      providersRefreshIntervalSeconds: Number.parseInt(process.env.PROVIDERS_REFRESH_INTERVAL_SECONDS || "14400", 10),
      dataRetentionPollIntervalSeconds: Number.parseInt(process.env.DATA_RETENTION_POLL_INTERVAL_SECONDS || "3600", 10),
      maintenanceWindowsUtc: (process.env.DEALBOT_MAINTENANCE_WINDOWS_UTC || "07:00,22:00")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
      maintenanceWindowMinutes: Number.parseInt(process.env.DEALBOT_MAINTENANCE_WINDOW_MINUTES || "20", 10),
    },
    jobs: {
      dealsPerSpPerHour: Number.parseFloat(process.env.DEALS_PER_SP_PER_HOUR || "4"),
      retrievalsPerSpPerHour: Number.parseFloat(process.env.RETRIEVALS_PER_SP_PER_HOUR || "2"),
      dataSetCreationsPerSpPerHour: Number.parseFloat(process.env.DATASET_CREATIONS_PER_SP_PER_HOUR || "1"),
      schedulerPollSeconds: Number.parseInt(process.env.JOB_SCHEDULER_POLL_SECONDS || "300", 10),
      workerPollSeconds: Number.parseInt(process.env.JOB_WORKER_POLL_SECONDS || "60", 10),
      pgbossLocalConcurrency: Number.parseInt(process.env.PG_BOSS_LOCAL_CONCURRENCY || "20", 10),
      pgbossSchedulerEnabled: process.env.DEALBOT_PGBOSS_SCHEDULER_ENABLED !== "false",
      pgbossPoolMax: Number.parseInt(process.env.DEALBOT_PGBOSS_POOL_MAX || "1", 10),
      catchupMaxEnqueue: Number.parseInt(process.env.JOB_CATCHUP_MAX_ENQUEUE || "10", 10),
      schedulePhaseSeconds: Number.parseInt(process.env.JOB_SCHEDULE_PHASE_SECONDS || "0", 10),
      enqueueJitterSeconds: Number.parseInt(process.env.JOB_ENQUEUE_JITTER_SECONDS || "0", 10),
      dealJobTimeoutSeconds: jobTimeoutSeconds.deal,
      retrievalJobTimeoutSeconds: jobTimeoutSeconds.retrieval,
      anonRetrievalJobTimeoutSeconds: jobTimeoutSeconds.anonRetrieval,
      retrievalsAnonPerSpPerHour: Number.parseFloat(
        process.env.RETRIEVALS_ANON_PER_SP_PER_HOUR || process.env.RETRIEVALS_PER_SP_PER_HOUR || "2",
      ),
      dataSetCreationJobTimeoutSeconds: jobTimeoutSeconds.dataSetCreation,
      pieceCleanupPerSpPerHour: Number.parseFloat(process.env.JOB_PIECE_CLEANUP_PER_SP_PER_HOUR || String(1 / 24)),
      maxPieceCleanupRuntimeSeconds: jobTimeoutSeconds.pieceCleanup,
    },
    dataset: {
      localDatasetsPath: process.env.DEALBOT_LOCAL_DATASETS_PATH || DEFAULT_LOCAL_DATASETS_PATH,
      randomDatasetSizes: (() => {
        const envValue = process.env.RANDOM_PIECE_SIZES;
        if (envValue && envValue.trim().length > 0) {
          const parsed = envValue
            .split(",")
            .map((s) => Number.parseInt(s.trim(), 10))
            .filter((n) => Number.isFinite(n) && !Number.isNaN(n));
          if (parsed.length > 0) {
            return parsed;
          }
        }
        return [
          10 << 20, // 10 MiB
        ];
      })(),
    },
    timeouts: {
      connectTimeoutMs: Number.parseInt(process.env.CONNECT_TIMEOUT_MS || "10000", 10),
      httpRequestTimeoutMs,
      http2RequestTimeoutMs,
      ipniVerificationTimeoutMs: Number.parseInt(process.env.IPNI_VERIFICATION_TIMEOUT_MS || "60000", 10),
      ipniVerificationPollingMs: Number.parseInt(process.env.IPNI_VERIFICATION_POLLING_MS || "2000", 10),
    },
    retrieval: {
      ipfsBlockFetchConcurrency: Number.parseInt(process.env.IPFS_BLOCK_FETCH_CONCURRENCY || "6", 10),
      anonBlockSampleCount: Number.parseInt(process.env.ANON_RETRIEVAL_BLOCK_SAMPLE_COUNT || "5", 10),
    },
    pieceCleanup: {
      maxDatasetStorageSizeBytes: Number.parseInt(
        process.env.MAX_DATASET_STORAGE_SIZE_BYTES || String(24 * 1024 * 1024 * 1024),
        10,
      ),
      targetDatasetStorageSizeBytes: Number.parseInt(
        process.env.TARGET_DATASET_STORAGE_SIZE_BYTES || String(20 * 1024 * 1024 * 1024),
        10,
      ),
    },
    spBlocklists: {
      ids: parseIdList(process.env.BLOCKED_SP_IDS),
      addresses: parseAddressList(process.env.BLOCKED_SP_ADDRESSES),
    },
  };
}
