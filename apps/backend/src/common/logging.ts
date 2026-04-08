type ErrorWithCode = Error & { code?: unknown };
const MAX_ERROR_STACK_LENGTH = 4 * 1024;

export type StructuredError = {
  type: "error" | "non_error";
  name?: string;
  message: string;
  code?: string;
  stack?: string;
  details?: unknown;
};

export function toJsonSafe(value: unknown): unknown {
  try {
    return JSON.parse(
      JSON.stringify(value, (_key, current) => (typeof current === "bigint" ? current.toString() : current)),
    );
  } catch {
    return String(value);
  }
}

function truncateErrorStack(stack: string | undefined): string | undefined {
  if (!stack || stack.length <= MAX_ERROR_STACK_LENGTH) {
    return stack;
  }

  const omittedChars = stack.length - MAX_ERROR_STACK_LENGTH;
  return `${stack.slice(0, MAX_ERROR_STACK_LENGTH)}... [truncated ${omittedChars} chars]`;
}

/**
 * Serializes unknown error values into structured JSON-friendly fields.
 */
export function toStructuredError(error: unknown): StructuredError {
  if (error instanceof Error) {
    const typedError = error as ErrorWithCode;
    const rawCode = typedError.code;
    const stringCode = rawCode === null || rawCode === undefined ? undefined : String(rawCode);

    return {
      type: "error",
      name: error.name,
      message: error.message,
      code: stringCode && stringCode.length > 0 ? stringCode : undefined,
      stack: truncateErrorStack(error.stack),
    };
  }

  if (typeof error === "string") {
    return {
      type: "non_error",
      message: error,
    };
  }

  return {
    type: "non_error",
    message: "Non-Error thrown",
    details: toJsonSafe(error),
  };
}

/**
 * Common base logging context for deal and retrieval operations.
 * Context fields are optional so callers can omit unknown identifiers rather
 * than emitting placeholder sentinels (e.g. "", -1).
 */
export type BaseDealRetrievalLogContext = {
  jobId?: string;
  dealId?: string;
  providerAddress?: string;
  providerId?: bigint;
  providerName?: string;
  pieceCid?: string | null;
  ipfsRootCID?: string;
};

/**
 * Structured logging context for deal-related operations
 */
export type DealLogContext = BaseDealRetrievalLogContext;

/**
 * Structured logging context for retrieval-related operations
 */
export type RetrievalLogContext = BaseDealRetrievalLogContext;

/**
 * Strict context for scheduled SP jobs where provider identity must be known.
 */
export type ProviderJobContext = {
  jobId: string;
  providerAddress: string;
  providerId: bigint;
  providerName: string;
};

/**
 * Structured logging context for data set creation operations
 */
export type DataSetLogContext = {
  jobId?: string;
  providerAddress: string;
  providerId?: bigint;
  providerName?: string;
  dataSetId?: number;
  dataSetIndex?: number;
  metadata?: Record<string, string>;
};

/**
 * Structured logging context for job-level operations
 */
export type JobLogContext = {
  jobId?: string;
  providerAddress: string;
  providerId?: bigint;
  providerName?: string;
};
