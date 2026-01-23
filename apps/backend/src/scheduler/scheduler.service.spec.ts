import { afterEach, describe, expect, it, vi } from "vitest";
import { DbAnchoredScheduler } from "./db-anchored-scheduler.js";

describe("DbAnchoredScheduler scheduling", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const createScheduler = () =>
    new DbAnchoredScheduler({
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    });

  it("uses the startup offset when no rows exist", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const scheduler = createScheduler();
    await scheduler.scheduleInitialRun({
      jobName: "dealCreation",
      intervalSeconds: 600,
      startOffsetSeconds: 120,
      getLastRunAt: async () => null,
      run: async () => {},
    });

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    const delayMs = setTimeoutSpy.mock.calls[0]?.[1];
    expect(delayMs).toBe(120 * 1000);
  });

  it("uses last created time when rows exist", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:05:00Z"));
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const scheduler = createScheduler();
    await scheduler.scheduleInitialRun({
      jobName: "dealCreation",
      intervalSeconds: 600,
      startOffsetSeconds: 120,
      getLastRunAt: async () => new Date("2024-01-01T00:10:00Z"),
      run: async () => {},
    });

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    const delayMs = setTimeoutSpy.mock.calls[0]?.[1];
    expect(delayMs).toBe(15 * 60 * 1000);
  });

  it("re-schedules based on newly created rows during execution", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const scheduler = createScheduler();
    const run = vi.fn().mockResolvedValue(undefined);
    const getLastRunAt = vi.fn().mockResolvedValue(new Date("2024-01-01T00:05:00Z"));

    await (scheduler as unknown as { executeScheduledJob: (args: unknown) => Promise<void> }).executeScheduledJob({
      jobName: "dealCreation",
      intervalSeconds: 600,
      getLastRunAt,
      run,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    const delayMs = setTimeoutSpy.mock.calls[0]?.[1];
    expect(delayMs).toBe(15 * 60 * 1000);
  });

  it("falls back to run completion time when no new rows were created", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const scheduler = createScheduler();
    const run = vi.fn().mockResolvedValue(undefined);
    const getLastRunAt = vi.fn().mockResolvedValue(null);

    await (scheduler as unknown as { executeScheduledJob: (args: unknown) => Promise<void> }).executeScheduledJob({
      jobName: "dealCreation",
      intervalSeconds: 600,
      getLastRunAt,
      run,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    const delayMs = setTimeoutSpy.mock.calls[0]?.[1];
    expect(delayMs).toBe(10 * 60 * 1000);
  });
});
