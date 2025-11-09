/**
 * Type definitions for IPNI strategy
 */

/**
 * Status information from PDP server for a piece
 */
export interface PieceStatus {
  status: string;
  indexed: boolean;
  advertised: boolean;
  retrieved: boolean;
  retrievedAt?: string | null;
}

/**
 * Result from monitoring piece status on PDP server
 */
export interface PieceMonitoringResult {
  success: boolean;
  finalStatus: PieceStatus;
  checks: number;
  durationMs: number;
}

/**
 * Information about a failed CID verification
 */
export interface FailedCID {
  cid: string;
  reason: string;
  addrs?: string[];
}

/**
 * Result from IPNI verification
 */
export interface IPNIVerificationResult {
  verified: number;
  unverified: number;
  total: number;
  rootCIDVerified: boolean;
  durationMs: number;
  failedCIDs: FailedCID[];
}

/**
 * Result from verifying the root CID
 */
export interface RootCIDVerificationResult {
  verified: boolean;
  failed?: FailedCID;
}

/**
 * Result from verifying multiple block CIDs
 */
export interface BlockCIDsVerificationResult {
  verified: number;
  failed: FailedCID[];
}

/**
 * Result from verifying a single CID
 */
export interface SingleCIDVerificationResult {
  verified: boolean;
  reason?: string;
  addrs?: string[];
}

/**
 * Combined result from monitoring and verification
 */
export interface MonitorAndVerifyResult {
  monitoringResult: PieceMonitoringResult;
  ipniResult: IPNIVerificationResult;
}
