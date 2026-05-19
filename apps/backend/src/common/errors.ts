/**
 * Response information extracted from HTTP errors
 */
export interface RetrievalErrorResponseInfo {
  statusCode?: number;
  responsePreview?: string;
}

/**
 * Thrown when a deal cannot be made because the targeted data set is
 * PDP-terminated. Callers map this to a FAILED outcome and defer to
 * `data_set_creation` for repair. See #379.
 */
export class DealJobTerminatedDataSetError extends Error {
  readonly name = "DealJobTerminatedDataSetError";

  constructor(public readonly dataSetId: bigint) {
    super(`Data set ${dataSetId.toString()} is PDP-terminated; awaiting data_set_creation repair`);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DealJobTerminatedDataSetError);
    }
  }
}

/**
 * Thrown by repairTerminatedDataSet when the dealbot wallet is a contract
 * (Safe multisig) and the dataset still needs to be terminated on-chain.
 * Dealbot's session-key signer is neither payer nor payee, so any direct
 * terminateService call reverts with CallerNotPayerOrPayee. An operator
 * must submit the termination via Safe (see https://github.com/FilOzone/dealbot/issues/545
 * for the pattern). Once pdpEndEpoch is set on FWSS, the existing
 * already-terminated branch in repairTerminatedDataSet runs the DB cleanup
 * automatically.
 *
 * Tracking: https://github.com/FilOzone/dealbot/issues/546
 */
export class DataSetTerminateRequiresOperatorError extends Error {
  readonly name = "DataSetTerminateRequiresOperatorError";

  constructor(
    public readonly dataSetId: bigint,
    public readonly providerAddress: string,
    public readonly payerAddress: string,
  ) {
    super(
      `Data set ${dataSetId.toString()} on provider ${providerAddress} cannot be auto-terminated; payer ${payerAddress} is a contract. Operator must submit terminateService via Safe.`,
    );
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DataSetTerminateRequiresOperatorError);
    }
  }
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
