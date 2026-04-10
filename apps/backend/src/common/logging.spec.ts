import { describe, expect, it } from "vitest";
import { toStructuredError } from "./logging.js";

describe("toStructuredError", () => {
  it("serializes Error instances into structured fields", () => {
    const error = Object.assign(new Error("boom"), { code: "E_BOOM" });

    const result = toStructuredError(error);

    expect(result).toEqual(
      expect.objectContaining({
        type: "error",
        name: "Error",
        message: "boom",
        code: "E_BOOM",
      }),
    );
    expect(result.stack).toContain("Error: boom");
  });

  it("serializes thrown strings as non_error", () => {
    expect(toStructuredError("failure")).toEqual({
      type: "non_error",
      message: "failure",
    });
  });

  it("normalizes non-string error codes to strings", () => {
    const error = Object.assign(new Error("boom"), { code: 404 });

    const result = toStructuredError(error);

    expect(result).toEqual(
      expect.objectContaining({
        type: "error",
        code: "404",
      }),
    );
  });

  it("truncates oversized stack traces", () => {
    const error = new Error("boom");
    const longStack = `Error: boom\n${"at fn (file.ts:1:1)\n".repeat(4000)}`;
    error.stack = longStack;

    const result = toStructuredError(error);

    expect(result.stack).toContain("Error: boom");
    expect(result.stack).toContain("[truncated ");
    expect(result.stack!.length).toBeLessThan(longStack.length);
  });

  it("serializes error cause chains", () => {
    const root = new Error("connection reset");
    const mid = new Error("fetch failed", { cause: root });
    const top = new Error("store failed", { cause: mid });

    const result = toStructuredError(top);

    expect(result.cause).toBeDefined();
    expect(result.cause!.message).toBe("fetch failed");
    expect(result.cause!.cause).toBeDefined();
    expect(result.cause!.cause!.message).toBe("connection reset");
    expect(result.cause!.cause!.cause).toBeUndefined();
  });

  it("limits cause depth to prevent infinite recursion", () => {
    let error: Error = new Error("root");
    for (let i = 0; i < 10; i++) {
      error = new Error(`level-${i}`, { cause: error });
    }

    const result = toStructuredError(error);

    let depth = 0;
    let current: typeof result | undefined = result;
    while (current?.cause) {
      depth++;
      current = current.cause;
    }
    expect(depth).toBeLessThanOrEqual(5);
  });

  it("serializes non-Error payloads and preserves bigint values as strings", () => {
    const payload = { a: 1n, nested: { ok: true } };

    const result = toStructuredError(payload);

    expect(result).toEqual({
      type: "non_error",
      message: "Non-Error thrown",
      details: { a: "1", nested: { ok: true } },
    });
  });
});
