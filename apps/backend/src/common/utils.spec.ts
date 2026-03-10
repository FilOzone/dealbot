import { CronJob } from "cron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleJobWithOffset, withTimeout } from "./utils.js";

// Mock the CronJob constructor - must use function syntax for constructor
vi.mock("cron", () => ({
  // biome-ignore lint/complexity/useArrowFunction: Constructor requires function syntax for 'new' operator
  CronJob: vi.fn(function (cronTime, onTick) {
    return {
      start: vi.fn(),
      cronTime,
      onTick,
    };
  }),
}));

describe("withTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

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
  });

  it("clears the timeout when the promise resolves first", async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    const resultPromise = withTimeout(Promise.resolve("done"), 50);
    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toBe("done");
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });
});

describe("scheduleJobWithOffset", () => {
  let schedulerRegistry: any;
  let logger: any;

  beforeEach(() => {
    schedulerRegistry = {
      addCronJob: vi.fn(),
    };
    logger = {
      log: vi.fn(),
      error: vi.fn(),
    };
    // Don't clear all mocks here as it would clear the CronJob mock
    // Instead, individual test mocks will be reset
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules a job with the correct offset and interval", async () => {
    vi.useFakeTimers();
    const CronJobMock = vi.mocked(CronJob);
    const callback = vi.fn().mockResolvedValue(undefined);

    scheduleJobWithOffset("test-job", 10, 60, schedulerRegistry, callback, logger);

    // Should not start immediately
    expect(CronJobMock).not.toHaveBeenCalled();

    // Advance time past offset
    await vi.advanceTimersByTimeAsync(10000);

    expect(CronJobMock).toHaveBeenCalledWith("0 * * * * *", expect.any(Function));
    expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith("test-job", expect.any(Object));
    expect(logger.log).toHaveBeenCalledWith("test-job started with 10s offset, running every 60s");
  });

  it("executes the callback and catches errors", async () => {
    vi.useFakeTimers();
    const CronJobMock = vi.mocked(CronJob);
    let jobCallback: () => Promise<void>;

    CronJobMock.mockImplementation(function (this: any, _, cb) {
      jobCallback = cb as () => Promise<void>;
      return { start: vi.fn() } as any;
    });

    const callback = vi.fn().mockRejectedValue(new Error("Job failed"));

    scheduleJobWithOffset("test-job", 10, 60, schedulerRegistry, callback, logger);

    // Advance time past offset to create the job
    await vi.advanceTimersByTimeAsync(10000);

    // Manually trigger the cron callback
    await jobCallback!();

    expect(callback).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "scheduled_job_failed",
        message: "Scheduled job test-job failed",
        error: expect.objectContaining({
          type: "error",
          name: "Error",
          message: "Job failed",
        }),
      }),
    );
  });

  it("continues scheduling after an error", async () => {
    vi.useFakeTimers();
    const CronJobMock = vi.mocked(CronJob);
    let jobCallback: () => Promise<void>;

    CronJobMock.mockImplementation(function (this: any, _, cb) {
      jobCallback = cb as () => Promise<void>;
      return { start: vi.fn() } as any;
    });

    const callback = vi.fn().mockRejectedValueOnce(new Error("Fail 1")).mockResolvedValueOnce(undefined);

    scheduleJobWithOffset("test-job", 10, 60, schedulerRegistry, callback, logger);

    await vi.advanceTimersByTimeAsync(10000);

    // First run fails
    await jobCallback!();
    expect(logger.error).toHaveBeenCalledTimes(1);

    // Second run succeeds (simulating next tick)
    await jobCallback!();
    expect(logger.error).toHaveBeenCalledTimes(1); // No new errors
  });
});
