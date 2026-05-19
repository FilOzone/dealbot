/** The result of anonymous piece selection. */
export type AnonPiece = {
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
  commPValid: boolean;
  errorMessage?: string;
  aborted?: boolean;
};

/** Result of CAR validation. */
export type CarValidationResult = {
  carParseable: boolean;
  blockCount: number;
  sampledCidCount: number;
  ipniValid: boolean | null;
  ipniVerifyMs: number | null;
  blockFetchValid: boolean | null;
  blockFetchFailedCount: number | null;
  blockFetchEndpoint: string | null;
  errorMessage?: string;
};
