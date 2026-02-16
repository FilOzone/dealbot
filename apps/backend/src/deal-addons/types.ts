import type { CID } from "multiformats";
import type { DataFile } from "../common/types.js";
import type { DealMetadata, DirectMetadata, IpniMetadata, ServiceType } from "../database/types.js";

/**
 * Configuration for creating a deal with optional add-ons
 */
export interface DealConfiguration {
  enableIpni: boolean;
  dataFile: DataFile;
}

/**
 * Result of data preprocessing by add-ons
 */
export interface PreprocessingResult<T extends IpniMetadata | DirectMetadata = any> {
  /** Processed data ready for upload */
  data: Buffer | Uint8Array;

  /** Metadata generated during preprocessing (e.g., CIDs, block info) */
  metadata: T;

  /** Original data kept for validation purposes (optional) */
  originalData?: Buffer;

  /** Size of processed data */
  size: number;
}

/**
 * Preprocessing results for each strategy
 */
export type IpniPreprocessingResult = PreprocessingResult<IpniMetadata>;
export type DirectPreprocessingResult = PreprocessingResult<DirectMetadata>;

/**
 * Complete result of deal preprocessing including all add-on configurations
 */
export interface DealPreprocessingResult {
  /** Final processed data ready for upload */
  processedData: {
    data: Buffer | Uint8Array;
    size: number;
    name: string;
  };

  /** Aggregated metadata from all add-ons */
  metadata: DealMetadata;

  /** Synapse SDK configuration merged from all add-ons */
  synapseConfig: SynapseConfig;

  /** Names of add-ons that were applied */
  appliedAddons: ServiceType[];
}

/**
 * Synapse Config options
 * Separates dataSet metadata (for createStorage) and piece metadata (for upload)
 */
export interface SynapseConfig {
  /** Metadata for dataSet creation (createStorage) */
  dataSetMetadata?: Record<string, string>;

  /** Metadata for piece upload (storage.upload) */
  pieceMetadata?: Record<string, string>;
}

/**
 * CAR file data structure for IPNI
 */
export interface CarDataFile {
  carData: Uint8Array;
  rootCID: CID;
  blockCIDs: CID[];
  blockCount: number;
  totalBlockSize: number;
  carSize: number;
}

/**
 * Add-on priority levels for preprocessing order
 */
export enum AddonPriority {
  /** Run first - data transformation add-ons (e.g., IPNI CAR conversion) */
  HIGH = 1,

  /** Run second - configuration add-ons */
  MEDIUM = 5,

  /** Run last - post-processing add-ons */
  LOW = 10,
}

/**
 * Add-on execution context with shared state
 */
export interface AddonExecutionContext {
  /** Current state of the data being processed */
  currentData: DataFile;

  /** Accumulated metadata from previous add-ons */
  accumulatedMetadata: DealMetadata;

  /** Original deal configuration */
  configuration: DealConfiguration;
}
