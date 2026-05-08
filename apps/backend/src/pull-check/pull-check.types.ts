/**
 * In-memory registration describing a hosted-piece source served at
 * `/api/piece/:pieceCid` for a single in-flight pull check.
 */
export type PullPieceRegistration = {
  pieceCid: string;
  providerAddress: string;
  key: string;
  size: number;
  expiresAt: Date;
  cleanedUp: boolean;
  pullSubmittedAt?: Date;
  firstByteAt?: Date;
};

/**
 * Result of preparing a hosted piece, returned by the service to callers that
 * need both the routing identity and the on-disk artifact path.
 */
export type PullPiecePrepared = {
  registration: PullPieceRegistration;
  sourceUrl: string;
};
