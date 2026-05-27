import type { Readable } from "node:stream";

/**
 * In-memory registration describing a hosted-piece source served at
 * `/api/piece/:pieceCid` for a single in-flight pull check.
 */
export type PullPieceRegistration = {
  pieceCid: string;
  providerAddress: string;
  key: string;
  size: number;
  pullSubmittedAt?: Date;
  firstByteAt?: Date;
  expiresAt: Date;
};

/**
 * Result of preparing a hosted piece, returned by the service to callers that
 * need both the routing identity and the on-disk artifact path.
 */
export type PullPiecePrepared = {
  registration: PullPieceRegistration;
  sourceUrl: string;
};

/**
 * Discriminated union returned by openPullPieceStream:
 * - "active": piece is within its TTL and a data stream is ready
 * - "gone": piece row exists but its TTL has passed (row not yet cleaned up)
 *
 * null means the piece is entirely unknown (row was never created or has
 * already been hard-deleted by the cleanup job).
 */
export type PullPieceStreamResult =
  | { status: "active"; registration: PullPieceRegistration; stream: Readable }
  | { status: "gone" };
