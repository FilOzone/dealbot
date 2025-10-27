export enum DealStatus {
  PENDING = "pending",
  UPLOADED = "uploaded",
  PIECE_ADDED = "piece_added",
  DEAL_CREATED = "deal_created",
  FAILED = "failed",
}

export enum ServiceType {
  DIRECT_SP = "direct_sp",
  CDN = "cdn",
  IPFS_PIN = "ipfs_pin",
}

export enum RetrievalStatus {
  PENDING = "pending",
  IN_PROGRESS = "in_progress",
  SUCCESS = "success",
  FAILED = "failed",
  TIMEOUT = "timeout",
}

/**
 * Metadata schema for deal storage and retrieval
 */

/**
 * CDN-specific metadata
 * Generated during deal preprocessing when CDN is enabled
 */
export interface CdnMetadata {
  /** Whether CDN is enabled for this deal */
  enabled: boolean;

  /** CDN provider name (e.g., "fil-beam") */
  provider: string;
}

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
  type: "direct";
}

/**
 * Complete deal metadata structure
 * Stored in deal.metadata JSONB column
 */
export interface DealMetadata {
  /** CDN metadata (if CDN is enabled) */
  cdn?: CdnMetadata;

  /** IPNI metadata (if IPNI is enabled) */
  ipni?: IpniMetadata;

  /** Direct storage metadata (always present) */
  direct: DirectMetadata;
}
