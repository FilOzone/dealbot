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
  retrievalsPerSpPerHour: 2,
  dataSetCreationsPerSpPerHour: 1,
  pieceCleanupPerSpPerHour: 1 / 24,
  maxPieceCleanupRuntimeSeconds: 300,
  dataRetentionPollIntervalSeconds: 3600,
  providersRefreshIntervalSeconds: 4 * 3600,
  maintenanceWindowsUtc: ["07:00", "22:00"],
  maintenanceWindowMinutes: 20,
  maxDatasetStorageSizeBytes: 24 * 1024 * 1024 * 1024, // 10GB
  targetDatasetStorageSizeBytes: 20 * 1024 * 1024 * 1024, // 8GB
} satisfies NetworkDefaults;

/**
 * Uppercase env-var prefixes for every supported network, e.g.
 * `["CALIBRATION", "MAINNET"]`
 */
export const NETWORK_ENV_PREFIXES = SUPPORTED_NETWORKS.map((n) => n.toUpperCase()) as Uppercase<Network>[];
