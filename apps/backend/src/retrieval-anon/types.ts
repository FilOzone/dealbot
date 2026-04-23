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
};

/** Result of CAR validation. */
export type CarValidationResult = {
  carParseable: boolean;
  blockCount: number;
  sampledCidCount: number;
  ipniValid: boolean | null;
  blockFetchValid: boolean | null;
  errorMessage?: string;
};
