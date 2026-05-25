import { SUPPORTED_NETWORKS } from "../common/constants.js";
import type { Network } from "../common/types.js";
import { NetworkDefaults } from "./types.js";

/**
 * Default values applied to every network config when the corresponding env
 * var is absent.  Override per-network via `<NETWORK>_*` env vars.
 */
export const networkDefaults = {
  checkDatasetCreationFees: true,
  useOnlyApprovedProviders: true,
  minNumDataSetsForChecks: 1,
  dealsPerSpPerHour: 4,
  dealJobTimeoutSeconds: 360,
  retrievalsPerSpPerHour: 2,
  retrievalJobTimeoutSeconds: 60,
  dataSetCreationsPerSpPerHour: 1,
  dataSetCreationJobTimeoutSeconds: 300,
  pieceCleanupPerSpPerHour: 1 / 24,
  maxPieceCleanupRuntimeSeconds: 300,
  dataRetentionPollIntervalSeconds: 3600,
  providersRefreshIntervalSeconds: 4 * 3600,
  maintenanceWindowsUtc: ["07:00", "22:00"],
  maintenanceWindowMinutes: 20,
  maxDatasetStorageSizeBytes: 24 * 1024 * 1024 * 1024, // 10GB
  targetDatasetStorageSizeBytes: 20 * 1024 * 1024 * 1024, // 8GB
  pullChecksPerSpPerHour: 1,
  pullCheckJobTimeoutSeconds: 300,
  pullCheckPollIntervalSeconds: 2,
  pullCheckPieceSizeBytes: 10 * 1024 * 1024, // 10 MiB
  pullPieceMaxConcurrentStreams: 50,
  pullPieceMaxStreamsPerCid: 3,
  pullPieceCleanupIntervalSeconds: 7 * 24 * 3600, // 7 days

  clickhouseBatchSize: 500,
  clickhouseFlushIntervalMs: 5000,
  clickhouseMaxBufferSize: 5000,
} satisfies NetworkDefaults;

/**
 * Uppercase env-var prefixes for every supported network, e.g.
 * `["CALIBRATION", "MAINNET"]`
 */
export const NETWORK_ENV_PREFIXES = SUPPORTED_NETWORKS.map((n) => n.toUpperCase()) as Uppercase<Network>[];
