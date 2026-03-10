import { afterEach, describe, expect, it, vi } from "vitest";
import { awaitWithAbort, createAbortError, delay } from "./abort-utils.js";

describe("createAbortError", () => {
  it("returns a generic AbortError when no signal is provided", () => {
    const error = createAbortError();
    expect(error.name).toBe("AbortError");
    expect(error.message).toBe("The operation was aborted");
  });

  it("returns the signal reason when it is an Error", () => {
    const reason = new Error("custom reason");
    const controller = new AbortController();
    controller.abort(reason);
    const error = createAbortError(controller.signal);
    expect(error).toBe(reason);
  });

  it("returns an AbortError that preserves non-Error reasons", () => {
    const controller = new AbortController();
    controller.abort("string reason");
    const error = createAbortError(controller.signal);
    expect(error.name).toBe("AbortError");
    expect(error.message).toBe("The operation was aborted: string reason");
    expect((error as Error & { cause?: unknown }).cause).toBe("string reason");
  });
});

describe("awaitWithAbort", () => {
  it("passes through the promise when no signal is provided", async () => {
    const result = await awaitWithAbort(Promise.resolve("hello"));
    expect(result).toBe("hello");
  });

  it("throws immediately when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(awaitWithAbort(Promise.resolve("hello"), controller.signal)).rejects.toThrow();
  });

  it("rejects when signal aborts during pending promise", async () => {
    const controller = new AbortController();
    const neverResolves = new Promise<string>(() => {});

    const resultPromise = awaitWithAbort(neverResolves, controller.signal);
    controller.abort(new Error("test abort"));

    await expect(resultPromise).rejects.toThrow("test abort");
  });

  it("resolves normally when promise resolves before abort", async () => {
    const controller = new AbortController();
    const result = await awaitWithAbort(Promise.resolve(42), controller.signal);
    expect(result).toBe(42);
  });

  it("rejects with the original error when promise rejects", async () => {
    const controller = new AbortController();
    const error = new Error("original error");
    await expect(awaitWithAbort(Promise.reject(error), controller.signal)).rejects.toThrow("original error");
  });
});

describe("delay", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves after the specified time", async () => {
    vi.useFakeTimers();
    const promise = delay(100);
    vi.advanceTimersByTime(100);
    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects immediately when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(delay(1000, controller.signal)).rejects.toThrow();
  });

  it("rejects when signal aborts during delay", async () => {
    const controller = new AbortController();
    const promise = delay(10_000, controller.signal);

    controller.abort(new Error("cancelled"));
    await expect(promise).rejects.toThrow("cancelled");
  });

  it("resolves normally when no signal is provided", async () => {
    vi.useFakeTimers();
    const promise = delay(50);
    vi.advanceTimersByTime(50);
    await expect(promise).resolves.toBeUndefined();
  });
});
