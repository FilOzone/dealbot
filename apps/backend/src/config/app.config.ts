import Joi from "joi";
import { DEFAULT_LOCAL_DATASETS_PATH } from "../common/constants.js";
import { parseMaintenanceWindowTimes } from "../common/maintenance-window.js";
import type { Network } from "../common/types.js";

export const configValidationSchema = Joi.object({
  // Application
  NODE_ENV: Joi.string().valid("development", "production", "test").default("development"),
  DEALBOT_RUN_MODE: Joi.string().lowercase().valid("api", "worker", "both").default("both"),
  DEALBOT_PORT: Joi.number().default(3000),
  DEALBOT_HOST: Joi.string().default("127.0.0.1"),
  DEALBOT_METRICS_PORT: Joi.number().default(9090),
  DEALBOT_METRICS_HOST: Joi.string().default("0.0.0.0"),
  ENABLE_DEV_MODE: Joi.boolean().default(false),
  DEALBOT_JOBS_MODE: Joi.string().valid("cron", "pgboss").default("cron"),

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
  WALLET_PRIVATE_KEY: Joi.string().required(),
  CHECK_DATASET_CREATION_FEES: Joi.boolean().default(true),
  USE_ONLY_APPROVED_PROVIDERS: Joi.boolean().default(true),
  ENABLE_IPNI_TESTING: Joi.string()
    .lowercase()
    .valid("disabled", "random", "always", "true", "false")
    .default("always"),
  DEALBOT_DATASET_VERSION: Joi.string().optional(),

  // Scheduling
  DEAL_INTERVAL_SECONDS: Joi.number().default(30),
  RETRIEVAL_INTERVAL_SECONDS: Joi.number()
    .min(1)
    .default(60)
    .custom((value, helpers) => {
      const root = helpers.state.ancestors[0] as {
        RETRIEVAL_TIMEOUT_BUFFER_MS?: number;
        HTTP_REQUEST_TIMEOUT_MS?: number;
        HTTP2_REQUEST_TIMEOUT_MS?: number;
      };
      const bufferMs = typeof root.RETRIEVAL_TIMEOUT_BUFFER_MS === "number" ? root.RETRIEVAL_TIMEOUT_BUFFER_MS : 0;
      const http1TimeoutMs = typeof root.HTTP_REQUEST_TIMEOUT_MS === "number" ? root.HTTP_REQUEST_TIMEOUT_MS : 0;
      const http2TimeoutMs = typeof root.HTTP2_REQUEST_TIMEOUT_MS === "number" ? root.HTTP2_REQUEST_TIMEOUT_MS : 0;
      const requiredMs = Math.max(http1TimeoutMs, http2TimeoutMs);
      const availableMs = value * 1000 - bufferMs;

      if (requiredMs > 0 && availableMs < requiredMs) {
        return helpers.error("any.invalid", {
          message:
            `"RETRIEVAL_INTERVAL_SECONDS" minus "RETRIEVAL_TIMEOUT_BUFFER_MS" must be ` +
            `>= max(HTTP_REQUEST_TIMEOUT_MS, HTTP2_REQUEST_TIMEOUT_MS) (${requiredMs} ms)`,
        });
      }

      return value;
    }),
  DEAL_START_OFFSET_SECONDS: Joi.number().default(0),
  RETRIEVAL_START_OFFSET_SECONDS: Joi.number().default(600),
  METRICS_START_OFFSET_SECONDS: Joi.number().default(900),
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
  // Per-hour limits are guardrails to avoid excessive background load.
  METRICS_PER_HOUR: Joi.number().min(0.001).max(3).optional(),
  DEALS_PER_SP_PER_HOUR: Joi.number().min(0.001).max(20).optional(),
  RETRIEVALS_PER_SP_PER_HOUR: Joi.number().min(0.001).max(20).optional(),
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

  // Dataset
  DEALBOT_LOCAL_DATASETS_PATH: Joi.string().default(DEFAULT_LOCAL_DATASETS_PATH),
  RANDOM_DATASET_SIZES: Joi.string().default("10240,10485760,104857600"), // 10 KiB, 10 MB, 100 MB

  // Proxy
  PROXY_LIST: Joi.string().default(""),
  PROXY_LOCATIONS: Joi.string().default(""),

  // Timeouts (in milliseconds)
  CONNECT_TIMEOUT_MS: Joi.number().min(1000).default(10000), // 10 seconds to establish connection/receive headers
  HTTP_REQUEST_TIMEOUT_MS: Joi.number().min(1000).default(240000), // 4 minutes total for HTTP requests (10MiB @ 170KB/s + overhead)
  HTTP2_REQUEST_TIMEOUT_MS: Joi.number().min(1000).default(240000), // 4 minutes total for HTTP/2 requests (10MiB @ 170KB/s + overhead)
  RETRIEVAL_TIMEOUT_BUFFER_MS: Joi.number()
    .min(0)
    .default(60000)
    .custom((value, helpers) => {
      const root = helpers.state.ancestors[0] as { RETRIEVAL_INTERVAL_SECONDS?: number };
      const retrievalIntervalSeconds =
        root && typeof root.RETRIEVAL_INTERVAL_SECONDS === "number" ? root.RETRIEVAL_INTERVAL_SECONDS : undefined;
      if (typeof retrievalIntervalSeconds !== "number" || retrievalIntervalSeconds <= 0) {
        return value;
      }
      const maxBufferMs = retrievalIntervalSeconds * 1000;
      if (value > maxBufferMs) {
        return helpers.error("any.invalid", {
          message: `"RETRIEVAL_TIMEOUT_BUFFER_MS" must be <= RETRIEVAL_INTERVAL_SECONDS * 1000 (${maxBufferMs} ms)`,
        });
      }
      return value;
    }), // Stop retrieval batch 60s before next run
});

export type IpniTestingMode = "disabled" | "random" | "always";

export interface IAppConfig {
  env: string;
  runMode: "api" | "worker" | "both";
  port: number;
  host: string;
  metricsPort: number;
  metricsHost: string;
  enableDevMode: boolean;
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
  walletAddress: string;
  walletPrivateKey: string;
  checkDatasetCreationFees: boolean;
  useOnlyApprovedProviders: boolean;
  enableIpniTesting: IpniTestingMode;
  dealbotDataSetVersion?: string;
}

export interface ISchedulingConfig {
  dealIntervalSeconds: number;
  retrievalIntervalSeconds: number;
  dealStartOffsetSeconds: number;
  retrievalStartOffsetSeconds: number;
  metricsStartOffsetSeconds: number;
  maintenanceWindowsUtc: string[];
  maintenanceWindowMinutes: number;
}

export interface IJobsConfig {
  /**
   * Selects the job execution engine.
   *
   * - `cron`: legacy in-process scheduler (default).
   * - `pgboss`: DB-backed scheduler with durable queues and catch-up behavior.
   *
   * Only used when `DEALBOT_JOBS_MODE=pgboss`.
   */
  mode: "cron" | "pgboss";
  /**
   * Target number of metrics runs per hour.
   *
   * Increasing this raises DB load due to more frequent materialized view refreshes.
   * Only used when `DEALBOT_JOBS_MODE=pgboss`.
   */
  metricsPerHour?: number;
  /**
   * Target number of deal creations per storage provider per hour.
   *
   * Increasing this increases on-chain activity and dataset uploads.
   * Only used when `DEALBOT_JOBS_MODE=pgboss`.
   */
  dealsPerSpPerHour?: number;
  /**
   * Target number of retrieval tests per storage provider per hour.
   *
   * Increasing this increases retrieval load against providers and DB writes.
   * Only used when `DEALBOT_JOBS_MODE=pgboss`.
   */
  retrievalsPerSpPerHour?: number;
  /**
   * How often the scheduler polls Postgres for due jobs (seconds).
   *
   * Lower values reduce scheduling latency but increase DB chatter.
   * Only used when `DEALBOT_JOBS_MODE=pgboss`.
   */
  schedulerPollSeconds: number;
  /**
   * How often workers check for new jobs (seconds).
   *
   * Lower values reduce job pickup latency but increase DB chatter.
   * Only used when `DEALBOT_JOBS_MODE=pgboss`.
   */
  workerPollSeconds: number;
  /**
   * Per-instance pg-boss worker concurrency for the `sp.work` queue.
   *
   * Only used when `DEALBOT_JOBS_MODE=pgboss`.
   */
  pgbossLocalConcurrency: number;
  /**
   * Enables the pg-boss scheduler loop (enqueueing due jobs).
   *
   * Set to false to run "worker-only" pods that only process existing jobs.
   * Only used when `DEALBOT_JOBS_MODE=pgboss`.
   */
  pgbossSchedulerEnabled: boolean;
  /**
   * Maximum number of pg-boss connections per instance.
   *
   * Helpful when using a session-mode pooler with a low pool_size (e.g. Supabase).
   * Only used when `DEALBOT_JOBS_MODE=pgboss`.
   */
  pgbossPoolMax: number;
  /**
   * Maximum number of jobs to enqueue per schedule row per poll.
   *
   * Prevents large backlogs from flooding workers after downtime.
   * Only used when `DEALBOT_JOBS_MODE=pgboss`.
   */
  catchupMaxEnqueue: number;
  /**
   * Per-instance phase offset (seconds) applied when initializing schedules.
   *
   * Use this to stagger multiple dealbot deployments that are not sharing a DB.
   * Only used when `DEALBOT_JOBS_MODE=pgboss`.
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
   * Only used when `DEALBOT_JOBS_MODE=pgboss`.
   */
  dealJobTimeoutSeconds: number;
  /**
   * Maximum runtime (seconds) for retrieval jobs before forced abort.
   *
   * Uses AbortController to actively cancel job execution.
   * Only used when `DEALBOT_JOBS_MODE=pgboss`.
   */
  retrievalJobTimeoutSeconds: number;
}

export interface IDatasetConfig {
  localDatasetsPath: string;
  randomDatasetSizes: number[];
}

export interface IProxyConfig {
  list: string[];
  locations: string[];
}

export interface ITimeoutConfig {
  connectTimeoutMs: number;
  httpRequestTimeoutMs: number;
  http2RequestTimeoutMs: number;
  retrievalTimeoutBufferMs: number;
}

export interface IConfig {
  app: IAppConfig;
  database: IDatabaseConfig;
  blockchain: IBlockchainConfig;
  scheduling: ISchedulingConfig;
  jobs: IJobsConfig;
  dataset: IDatasetConfig;
  proxy: IProxyConfig;
  timeouts: ITimeoutConfig;
}

const parseIpniTestingMode = (value: string | undefined): IpniTestingMode => {
  if (!value) {
    return "always";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return "always";
  }
  if (normalized === "false") {
    return "disabled";
  }
  if (normalized === "disabled" || normalized === "random" || normalized === "always") {
    return normalized;
  }
  return "always";
};

export function loadConfig(): IConfig {
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
      walletAddress: process.env.WALLET_ADDRESS || "0x0000000000000000000000000000000000000000",
      walletPrivateKey: process.env.WALLET_PRIVATE_KEY || "",
      checkDatasetCreationFees: process.env.CHECK_DATASET_CREATION_FEES !== "false",
      useOnlyApprovedProviders: process.env.USE_ONLY_APPROVED_PROVIDERS !== "false",
      enableIpniTesting: parseIpniTestingMode(process.env.ENABLE_IPNI_TESTING),
      dealbotDataSetVersion: process.env.DEALBOT_DATASET_VERSION,
    },
    scheduling: {
      dealIntervalSeconds: Number.parseInt(process.env.DEAL_INTERVAL_SECONDS || "30", 10),
      retrievalIntervalSeconds: Number.parseInt(process.env.RETRIEVAL_INTERVAL_SECONDS || "60", 10),
      dealStartOffsetSeconds: Number.parseInt(process.env.DEAL_START_OFFSET_SECONDS || "0", 10),
      retrievalStartOffsetSeconds: Number.parseInt(process.env.RETRIEVAL_START_OFFSET_SECONDS || "600", 10),
      metricsStartOffsetSeconds: Number.parseInt(process.env.METRICS_START_OFFSET_SECONDS || "900", 10),
      maintenanceWindowsUtc: (process.env.DEALBOT_MAINTENANCE_WINDOWS_UTC || "07:00,22:00")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
      maintenanceWindowMinutes: Number.parseInt(process.env.DEALBOT_MAINTENANCE_WINDOW_MINUTES || "20", 10),
    },
    jobs: {
      mode: (process.env.DEALBOT_JOBS_MODE || "cron") as "cron" | "pgboss",
      metricsPerHour: process.env.METRICS_PER_HOUR ? Number.parseFloat(process.env.METRICS_PER_HOUR) : undefined,
      dealsPerSpPerHour: process.env.DEALS_PER_SP_PER_HOUR
        ? Number.parseFloat(process.env.DEALS_PER_SP_PER_HOUR)
        : undefined,
      retrievalsPerSpPerHour: process.env.RETRIEVALS_PER_SP_PER_HOUR
        ? Number.parseFloat(process.env.RETRIEVALS_PER_SP_PER_HOUR)
        : undefined,
      schedulerPollSeconds: Number.parseInt(process.env.JOB_SCHEDULER_POLL_SECONDS || "300", 10),
      workerPollSeconds: Number.parseInt(process.env.JOB_WORKER_POLL_SECONDS || "60", 10),
      pgbossLocalConcurrency: Number.parseInt(process.env.PG_BOSS_LOCAL_CONCURRENCY || "20", 10),
      pgbossSchedulerEnabled: process.env.DEALBOT_PGBOSS_SCHEDULER_ENABLED !== "false",
      pgbossPoolMax: Number.parseInt(process.env.DEALBOT_PGBOSS_POOL_MAX || "1", 10),
      catchupMaxEnqueue: Number.parseInt(process.env.JOB_CATCHUP_MAX_ENQUEUE || "10", 10),
      schedulePhaseSeconds: Number.parseInt(process.env.JOB_SCHEDULE_PHASE_SECONDS || "0", 10),
      enqueueJitterSeconds: Number.parseInt(process.env.JOB_ENQUEUE_JITTER_SECONDS || "0", 10),
      dealJobTimeoutSeconds: Number.parseInt(process.env.DEAL_JOB_TIMEOUT_SECONDS || "360", 10),
      retrievalJobTimeoutSeconds: Number.parseInt(process.env.RETRIEVAL_JOB_TIMEOUT_SECONDS || "60", 10),
    },
    dataset: {
      localDatasetsPath: process.env.DEALBOT_LOCAL_DATASETS_PATH || DEFAULT_LOCAL_DATASETS_PATH,
      randomDatasetSizes: (() => {
        const envValue = process.env.RANDOM_DATASET_SIZES;
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
          10 << 10, // 10 KiB
          10 << 20, // 10 MB
          100 << 20, // 100 MB
        ];
      })(),
    },
    proxy: {
      list: process.env.PROXY_LIST?.split(",") || [],
      locations: process.env.PROXY_LOCATIONS?.split(",") || [],
    },
    timeouts: {
      connectTimeoutMs: Number.parseInt(process.env.CONNECT_TIMEOUT_MS || "10000", 10),
      httpRequestTimeoutMs: Number.parseInt(process.env.HTTP_REQUEST_TIMEOUT_MS || "240000", 10),
      http2RequestTimeoutMs: Number.parseInt(process.env.HTTP2_REQUEST_TIMEOUT_MS || "240000", 10),
      retrievalTimeoutBufferMs: Number.parseInt(process.env.RETRIEVAL_TIMEOUT_BUFFER_MS || "60000", 10),
    },
  };
}
