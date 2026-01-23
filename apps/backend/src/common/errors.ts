/**
 * Response information extracted from HTTP errors
 */
export interface RetrievalErrorResponseInfo {
  statusCode?: number;
  responsePreview?: string;
}

/**
 * Custom error class for retrieval failures with HTTP context
 * Provides structured information about failed HTTP requests
 */
export class RetrievalError extends Error {
  readonly name = "RetrievalError";

  constructor(
    message: string,
    public readonly responseInfo?: RetrievalErrorResponseInfo,
    public readonly code?: string,
  ) {
    super(message);
    // Maintains proper stack trace for where error was thrown (only in V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RetrievalError);
    }
  }

  /**
   * Create a RetrievalError from an HTTP response
   */
  static fromHttpResponse(statusCode: number, responsePreview?: string): RetrievalError {
    return new RetrievalError(`HTTP ${statusCode} response`, { statusCode, responsePreview });
  }
}
