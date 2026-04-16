import { describe, expect, it } from "vitest";
import { redactSensitiveText, toStructuredError } from "./logging.js";

describe("toStructuredError", () => {
  it("redacts sensitive credentials from URLs in plain text", () => {
    expect(redactSensitiveText("URL: https://user:pass@example.com/rpc/v1?token=secret&api_key=another&ok=1")).toBe(
      "URL: https://REDACTED:REDACTED@example.com/rpc/v1?token=REDACTED&api_key=REDACTED&ok=1",
    );
  });

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

  it("redacts sensitive URLs from error messages, stacks, and causes", () => {
    const cause = new Error("URL: https://example.com/rpc?access_token=cause-secret");
    const error = new Error("URL: https://example.com/rpc?token=top-secret&ok=1", { cause });
    error.stack = `Error: request failed\nURL: https://example.com/rpc?apikey=stack-secret`;

    const result = toStructuredError(error);

    expect(result.message).toContain("token=REDACTED");
    expect(result.message).toContain("ok=1");
    expect(result.message).not.toContain("top-secret");
    expect(result.stack).toContain("apikey=REDACTED");
    expect(result.stack).not.toContain("stack-secret");
    expect(result.cause?.message).toContain("access_token=REDACTED");
    expect(result.cause?.message).not.toContain("cause-secret");
  });

  it("redacts sensitive URLs from thrown strings", () => {
    expect(toStructuredError("URL: https://example.com/rpc?authorization=secret").message).toContain(
      "authorization=REDACTED",
    );
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
