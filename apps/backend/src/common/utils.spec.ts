import { describe, expect, it, vi } from "vitest";
import { withTimeout } from "./utils.js";

describe("withTimeout", () => {
  it("resolves when the promise completes before the timeout", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 50);
    expect(result).toBe("ok");
  });

  it("rejects when the timeout is exceeded", async () => {
    vi.useFakeTimers();

    const promise = withTimeout(new Promise(() => {}), 25, "timed out");
    const assertion = expect(promise).rejects.toThrow("timed out");

    await vi.advanceTimersByTimeAsync(25);

    await assertion;
    vi.useRealTimers();
  });
});
