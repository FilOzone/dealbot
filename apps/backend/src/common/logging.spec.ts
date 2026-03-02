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
