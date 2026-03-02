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
