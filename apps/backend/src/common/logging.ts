type ErrorWithCode = Error & { code?: unknown };

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
      stack: error.stack,
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
