/**
 * In-memory registration describing a hosted-piece source served at
 * `/api/piece/:pieceCid` for a single in-flight pull check.
 */
export type HostedPieceRegistration = {
  pieceCid: string;
  filePath: string;
  fileName: string;
  byteLength: number;
  contentType: string;
  expiresAt: Date;
  cleanedUp: boolean;
};

/**
 * Result of preparing a hosted piece, returned by the service to callers that
 * need both the routing identity and the on-disk artifact path.
 */
export type HostedPiecePrepared = {
  registration: HostedPieceRegistration;
  sourceUrl: string;
};
