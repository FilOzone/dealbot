import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IConfig } from "../config/app.config.js";
import { JobsService } from "./jobs.service.js";

const callPrivate = <T>(target: T, key: string, ...args: unknown[]) => {
  return (target as unknown as Record<string, (...innerArgs: unknown[]) => unknown>)[key](...args);
};

describe("JobsService schedule rows", () => {
  let service: JobsService;
  let storageProviderRepositoryMock: { find: ReturnType<typeof vi.fn> };
  let jobScheduleRepositoryMock: {
    upsertSchedule: ReturnType<typeof vi.fn>;
    pauseMissingProviders: ReturnType<typeof vi.fn>;
    findDueSchedulesWithManager: ReturnType<typeof vi.fn>;
    runTransaction: ReturnType<typeof vi.fn>;
    acquireAdvisoryLock: ReturnType<typeof vi.fn>;
    releaseAdvisoryLock: ReturnType<typeof vi.fn>;
    updateScheduleAfterRun: ReturnType<typeof vi.fn>;
  };
  let baseConfigValues: Partial<IConfig>;

  beforeEach(() => {
    storageProviderRepositoryMock = {
      find: vi.fn(),
    };

    jobScheduleRepositoryMock = {
      upsertSchedule: vi.fn(),
      pauseMissingProviders: vi.fn(),
      findDueSchedulesWithManager: vi.fn(),
      runTransaction: vi.fn(async (callback: (manager: unknown) => Promise<void>) => {
        await callback({});
      }),
      acquireAdvisoryLock: vi.fn(),
      releaseAdvisoryLock: vi.fn(),
      updateScheduleAfterRun: vi.fn(),
    };

    baseConfigValues = {
      blockchain: { useOnlyApprovedProviders: false } as IConfig["blockchain"],
      scheduling: {
        dealIntervalSeconds: 600,
        retrievalIntervalSeconds: 1200,
      } as IConfig["scheduling"],
      jobs: {
        schedulePhaseSeconds: 0,
        catchupMaxEnqueue: 10,
        catchupSpreadHours: 3,
        enqueueJitterSeconds: 0,
        lockRetrySeconds: 60,
      } as IConfig["jobs"],
      database: {
        host: "localhost",
        port: 5432,
        username: "user",
        password: "pass",
        database: "dealbot",
      } as IConfig["database"],
    };

    const configService = {
      get: vi.fn((key: keyof IConfig) => baseConfigValues[key]),
    };

    service = new JobsService(
      configService as any,
      storageProviderRepositoryMock as any,
      jobScheduleRepositoryMock as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("adds schedule rows for newly seen providers", async () => {
    const providerA = { address: "0xaaa" };
    const providerB = { address: "0xbbb" };

    storageProviderRepositoryMock.find.mockResolvedValueOnce([providerA]).mockResolvedValueOnce([providerA, providerB]);

    await callPrivate(service, "ensureScheduleRows");
    await callPrivate(service, "ensureScheduleRows");

    // Check upserts for providerB
    const upsertCalls = jobScheduleRepositoryMock.upsertSchedule.mock.calls;
    const upsertsForB = upsertCalls.filter((call) => call[1] === providerB.address);
    expect(upsertsForB).toHaveLength(2);
    expect(upsertsForB.map((call) => call[0]).sort()).toEqual(["deal", "retrieval"]);
  });

  it("pauses schedule rows for providers no longer present", async () => {
    const providerA = { address: "0xaaa" };
    storageProviderRepositoryMock.find.mockResolvedValueOnce([providerA]);

    await callPrivate(service, "ensureScheduleRows");

    expect(jobScheduleRepositoryMock.pauseMissingProviders).toHaveBeenCalledWith([providerA.address]);
  });

  it("uses approved-only filter when configured", async () => {
    baseConfigValues = {
      ...baseConfigValues,
      blockchain: { useOnlyApprovedProviders: true } as IConfig["blockchain"],
    };
    const configService = {
      get: vi.fn((key: keyof IConfig) => baseConfigValues[key]),
    };

    service = new JobsService(
      configService as any,
      storageProviderRepositoryMock as any,
      jobScheduleRepositoryMock as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    storageProviderRepositoryMock.find.mockResolvedValueOnce([]);
    await callPrivate(service, "ensureScheduleRows");

    expect(storageProviderRepositoryMock.find).toHaveBeenCalledWith({
      select: { address: true },
      where: { isActive: true, isApproved: true },
    });
  });

  it("always inserts global metrics schedules", async () => {
    storageProviderRepositoryMock.find.mockResolvedValueOnce([]);

    await callPrivate(service, "ensureScheduleRows");

    expect(jobScheduleRepositoryMock.upsertSchedule).toHaveBeenCalledWith(
      "metrics",
      "",
      expect.any(Number),
      expect.any(Date),
    );
    expect(jobScheduleRepositoryMock.upsertSchedule).toHaveBeenCalledWith(
      "metrics_cleanup",
      "",
      expect.any(Number),
      expect.any(Date),
    );
  });

  it("caps catch-up enqueue count and respects immediate vs delayed", async () => {
    baseConfigValues = {
      ...baseConfigValues,
      jobs: {
        ...baseConfigValues.jobs,
        catchupMaxEnqueue: 3,
        catchupSpreadHours: 1,
        enqueueJitterSeconds: 0,
      } as IConfig["jobs"],
    };
    const configService = {
      get: vi.fn((key: keyof IConfig) => baseConfigValues[key]),
    };

    service = new JobsService(
      configService as any,
      storageProviderRepositoryMock as any,
      jobScheduleRepositoryMock as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const publish = vi.fn();
    (service as unknown as { boss: { publish: typeof publish } }).boss = { publish };

    const now = new Date("2024-01-01T00:00:10Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    jobScheduleRepositoryMock.findDueSchedulesWithManager.mockResolvedValueOnce([
      {
        id: 1,
        job_type: "deal",
        sp_address: "0xaaa",
        interval_seconds: 1,
        next_run_at: "2024-01-01T00:00:00Z",
      },
    ]);

    await callPrivate(service, "enqueueDueJobs");

    expect(publish).toHaveBeenCalledTimes(3);
    const startAfters = publish.mock.calls.map((call) => call[2]?.startAfter as Date);
    for (const startAfter of startAfters) {
      expect(startAfter).toBeInstanceOf(Date);
    }
    const timestamps = startAfters.map((startAfter) => startAfter.getTime()).sort((a, b) => a - b);
    expect(timestamps[0]).toBe(now.getTime());
    expect(timestamps[1]).toBeGreaterThan(now.getTime());
    expect(timestamps[2]).toBeGreaterThan(timestamps[1]);

    // Check update call
    expect(jobScheduleRepositoryMock.updateScheduleAfterRun).toHaveBeenCalled();
  });

  it("requeues deal job when lock cannot be acquired", async () => {
    baseConfigValues = {
      ...baseConfigValues,
      jobs: {
        ...baseConfigValues.jobs,
        lockRetrySeconds: 10,
      } as IConfig["jobs"],
    };
    const configService = {
      get: vi.fn((key: keyof IConfig) => baseConfigValues[key]),
    };

    service = new JobsService(
      configService as any,
      storageProviderRepositoryMock as any,
      jobScheduleRepositoryMock as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const publish = vi.fn();
    (service as unknown as { boss: { publish: typeof publish } }).boss = { publish };

    jobScheduleRepositoryMock.acquireAdvisoryLock.mockResolvedValueOnce(false);

    const now = new Date("2024-01-01T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    await callPrivate(service, "handleDealJob", { spAddress: "0xaaa", intervalSeconds: 60 });

    expect(publish).toHaveBeenCalledTimes(1);
    const startAfter = publish.mock.calls[0][2]?.startAfter as Date;
    expect(startAfter.getTime()).toBeGreaterThanOrEqual(now.getTime() + 10_000);

    vi.useRealTimers();
  });
});
