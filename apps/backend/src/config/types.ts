import { Network } from "../common/types.js";

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

type BaseNetworkConfig = {
  network: Network;

  /** Blockchain Config */
  rpcUrl?: string;
  walletAddress: string;
  checkDatasetCreationFees: boolean;
  useOnlyApprovedProviders: boolean;
  dealbotDataSetVersion?: string;
  pdpSubgraphEndpoint?: string;
  minNumDataSetsForChecks: number;

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
   * Target number of piece cleanup runs per storage provider per hour.
   *
   * Increasing this makes cleanup more aggressive at the cost of more SP API calls.
   */
  pieceCleanupPerSpPerHour: number;
  maxPieceCleanupRuntimeSeconds: number;
  dataRetentionPollIntervalSeconds: number;
  providersRefreshIntervalSeconds: number;

  /** Maintenance Config */
  maintenanceWindowsUtc: string[];
  maintenanceWindowMinutes: number;

  /** Blocked Providers Config */
  blockedSpIds: Set<string>;
  blockedSpAddresses: Set<string>;

  /** Piece Cleanup Config */
  maxDatasetStorageSizeBytes: number;
  targetDatasetStorageSizeBytes: number;
};

type WalletPrivateKeyNetworkConfig = BaseNetworkConfig & {
  walletPrivateKey: `0x${string}`;
};

type SessionKeyNetworkConfig = BaseNetworkConfig & {
  sessionKeyPrivateKey: `0x${string}`;
};

export type INetworkConfig = WalletPrivateKeyNetworkConfig | SessionKeyNetworkConfig;

export type INetworksConfig = Record<Network, INetworkConfig>;

export interface IJobsConfig {
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
}

export interface IConfig {
  app: IAppConfig;
  database: IDatabaseConfig;
  networks: INetworksConfig;
  activeNetworks: Network[];
  jobs: IJobsConfig;
  dataset: IDatasetConfig;
  timeouts: ITimeoutConfig;
  retrieval: IRetrievalConfig;
}

export type NetworkDefaults = Pick<
  INetworkConfig,
  | "dealbotDataSetVersion"
  | "checkDatasetCreationFees"
  | "useOnlyApprovedProviders"
  | "minNumDataSetsForChecks"
  | "dealsPerSpPerHour"
  | "retrievalsPerSpPerHour"
  | "dataSetCreationsPerSpPerHour"
  | "pieceCleanupPerSpPerHour"
  | "maxPieceCleanupRuntimeSeconds"
  | "dataRetentionPollIntervalSeconds"
  | "providersRefreshIntervalSeconds"
  | "maintenanceWindowsUtc"
  | "maintenanceWindowMinutes"
  | "maxDatasetStorageSizeBytes"
  | "targetDatasetStorageSizeBytes"
>;
