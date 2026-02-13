export enum DealStatus {
  PENDING = "pending",
  UPLOADED = "uploaded",
  PIECE_ADDED = "piece_added",
  PIECE_CONFIRMED = "piece_confirmed",
  DEAL_CREATED = "deal_created",
  FAILED = "failed",
}

export enum ServiceType {
  DIRECT_SP = "direct_sp",
  IPFS_PIN = "ipfs_pin",
}

export enum MetricType {
  DEAL = "deal",
  RETRIEVAL = "retrieval",
}

export enum RetrievalStatus {
  PENDING = "pending",
  IN_PROGRESS = "in_progress",
  SUCCESS = "success",
  FAILED = "failed",
  TIMEOUT = "timeout",
}

export enum IpniStatus {
  PENDING = "pending",
  SP_INDEXED = "sp_indexed",
  SP_ADVERTISED = "sp_advertised",
  /**
   * @deprecated
   * This status is no longer used by new code paths and is kept only for legacy data handling.
   * It must not be used for any new writes or business logic.
   *
   * TODO: Fully remove from the database schema and all queries once the migration
   * tracked in https://github.com/FilOzone/dealbot/issues/168 is complete.
   */
  SP_RECEIVED_RETRIEVE_REQUEST = "sp_received_retrieve_request",
  VERIFIED = "verified",
  FAILED = "failed",
}

/**
 * Metadata schema for deal storage and retrieval
 */

/**
 * IPNI-specific metadata
 * Generated during CAR conversion when IPNI is enabled
 */
export interface IpniMetadata {
  /** Whether IPNI is enabled for this deal */
  enabled: boolean;

  /** Root CID of the CAR file */
  rootCID: string;

  /** Array of block CIDs in the CAR file */
  blockCIDs: string[];

  /** Number of blocks in the CAR file */
  blockCount: number;

  /** Total size of the CAR file in bytes */
  carSize: number;

  /** Original file size before CAR conversion */
  originalSize: number;
}

/**
 * Direct storage metadata
 * Generated for all deals as baseline
 */
export interface DirectMetadata {
  /** Storage type identifier */
  type?: "direct";
}

/**
 * Complete deal metadata structure
 * Stored in deal.metadata JSONB column
 */
export interface DealMetadata {
  /** IPNI metadata (if IPNI is enabled) */
  [ServiceType.IPFS_PIN]?: IpniMetadata;

  /** Direct storage metadata (always present) */
  [ServiceType.DIRECT_SP]?: DirectMetadata;
}
