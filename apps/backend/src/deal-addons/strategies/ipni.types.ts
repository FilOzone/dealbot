import Joi from "joi";

/**
 * Type definitions for IPNI strategy
 */

/**
 * Response from PDP server for piece status
 * Includes indexing and advertisement status
 */
export interface PieceStatusResponse {
  pieceCid: string;
  status: string;
  indexed: boolean;
  advertised: boolean;
}

const pieceStatusResponseSchema = Joi.object({
  pieceCid: Joi.string().required(),
  status: Joi.string().required(),
  indexed: Joi.boolean().required(),
  advertised: Joi.boolean().required(),
})
  .unknown(true)
  .required();

/**
 * Type guard for PieceStatusResponse
 * Validates the response from checking piece indexing and IPNI status
 *
 * @param value - The value to validate
 * @returns True if the value matches PieceStatusResponse interface
 */
export function isPieceStatusResponse(value: unknown): value is PieceStatusResponse {
  return !pieceStatusResponseSchema.validate(value).error;
}

/**
 * Validates and returns a PieceStatusResponse
 * @param value - The value to validate
 * @throws Error if validation fails
 */
export function validatePieceStatusResponse(value: unknown): PieceStatusResponse {
  const { error, value: validated } = pieceStatusResponseSchema.validate(value, { abortEarly: false });
  if (error) {
    throw new Error(`Invalid piece status response format: ${error.message}`);
  }
  return validated as PieceStatusResponse;
}

/**
 * Status information from PDP server for a piece
 */
export interface PieceStatus {
  status: string;
  indexed: boolean;
  advertised: boolean;
  indexedAt: string | null;
  advertisedAt: string | null;
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
  verifiedAt: string;
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
