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
  rpcRequestTimeoutMs: 30000,
  dealsPerSpPerHour: 4,
  dealJobTimeoutSeconds: 360,
  retrievalsPerSpPerHour: 2,
  sampledRetrievalsPerSpPerHour: 2,
  retrievalJobTimeoutSeconds: 60,
  sampledRetrievalJobTimeoutSeconds: 360,
  dataSetCreationsPerSpPerHour: 1,
  dataSetCreationJobTimeoutSeconds: 300,
  dataSetLifecycleChecksPerSpPerHour: 1,
  dataSetLifecycleCheckJobTimeoutSeconds: 600,
  pieceCleanupPerSpPerHour: 1 / 24,
  maxPieceCleanupRuntimeSeconds: 300,
  dataRetentionPollIntervalSeconds: 3600,
  providersRefreshIntervalSeconds: 4 * 3600,
  maintenanceWindowsUtc: ["07:00", "22:00"],
  maintenanceWindowMinutes: 20,
  maxDatasetStorageSizeBytes: 24 * 1024 * 1024 * 1024, // 24 GiB
  targetDatasetStorageSizeBytes: 20 * 1024 * 1024 * 1024, // 20 GiB
  pullChecksPerSpPerHour: 1,
  pullCheckJobTimeoutSeconds: 300,
  pullCheckPollIntervalSeconds: 2,
  pullCheckPieceSizeBytes: 10 * 1024 * 1024, // 10 MiB
  pullPieceCleanupIntervalSeconds: 7 * 24 * 3600, // 7 days
} satisfies NetworkDefaults;

/**
 * Uppercase env-var prefixes for every supported network, e.g.
 * `["CALIBRATION", "MAINNET"]`
 */
export const NETWORK_ENV_PREFIXES = SUPPORTED_NETWORKS.map((n) => n.toUpperCase()) as Uppercase<Network>[];
