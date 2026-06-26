import type { CID } from "multiformats/cid";
import { BlockFetchStatus, CarParseStatus, IpniCheckStatus } from "../database/types.js";

/** The result of anonymous piece selection. */
export type SampledPiece = {
  pieceCid: string;
  dataSetId: string;
  pieceId: string;
  serviceProvider: string;
  withIPFSIndexing: boolean;
  ipfsRootCid: string | null;
  rawSize: string;
};

/** Result of piece retrieval. */
export type PieceRetrievalResult = {
  success: boolean;
  pieceCid: string;
  bytesReceived: number;
  pieceBytes: Buffer | null;
  latencyMs: number;
  ttfbMs: number;
  throughputBps: number;
  statusCode: number;
  httpSuccess: boolean;
  commPValid: boolean;
  errorMessage?: string;
  aborted?: boolean;
};

/** A block decoded from the CAR, retained for IPNI verification + block fetch. */
export type SampledBlock = { cid: CID; bytes: Uint8Array };

/**
 * Result of CAR parsing. SKIPPED is never produced here — the
 * caller decides "this dimension never ran" semantics.
 */
export type CarParseOutcome =
  | { status: CarParseStatus.SUCCESS; blockCount: number; sampledBlocks: SampledBlock[] }
  | { status: CarParseStatus.FAILURE_NOT_PARSEABLE; errorMessage?: string };

/**
 * Result of an IPNI verification attempt. `SKIPPED` is returned when a
 * structural prerequisite couldn't be met (root CID won't parse).
 * `FAILURE_OTHER` is reserved for unexpected exceptions raised by the verifier.
 */
export type IpniCheckOutcome = {
  status: IpniCheckStatus;
  durationMs: number | null;
};

/**
 * Result of the block-fetch sampling step. `SKIPPED` is returned when a
 * structural prerequisite couldn't be met (SP info not registered).
 * `FAILURE_OTHER` covers both block verification failures and unexpected
 * exceptions raised by the fetcher.
 */
export type BlockFetchOutcome = {
  status: BlockFetchStatus;
  sampledCount: number;
  failedCount: number | null;
  endpoint: string | null;
  errorMessage?: string;
};
