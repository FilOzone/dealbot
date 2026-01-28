export type HttpVersion = "1.1" | "2";

export interface RequestMetrics {
  ttfb: number;
  totalTime: number;
  downloadTime: number;
  proxyUrl: string;
  statusCode: number;
  responseSize: number;
  timestamp: Date;
  httpVersion?: HttpVersion;
}

export interface RequestWithMetrics<T> {
  data: T;
  metrics: RequestMetrics;
}

/**
 * Response from PDP server for piece status
 * Includes indexing, advertisement, and retrieval status
 */
export interface PieceStatusResponse {
  pieceCid: string;
  status: string;
  indexed: boolean;
  advertised: boolean;
}

/**
 * Type guard for PieceStatusResponse
 * Validates the response from checking piece indexing and IPNI status
 *
 * @param value - The value to validate
 * @returns True if the value matches PieceStatusResponse interface
 */
export function isPieceStatusResponse(value: unknown): value is PieceStatusResponse {
  if (typeof value !== "object" || value == null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  // Required fields
  if (typeof obj.pieceCid !== "string") {
    return false;
  }
  if (typeof obj.status !== "string") {
    return false;
  }
  if (typeof obj.indexed !== "boolean") {
    return false;
  }
  if (typeof obj.advertised !== "boolean") {
    return false;
  }

  return true;
}

/**
 * Validates and returns a PieceStatusResponse
 * @param value - The value to validate
 * @throws Error if validation fails
 */
export function validatePieceStatusResponse(value: unknown): PieceStatusResponse {
  if (!isPieceStatusResponse(value)) {
    throw new Error(`Invalid piece status response format: ${JSON.stringify(value)}`);
  }
  return value;
}
