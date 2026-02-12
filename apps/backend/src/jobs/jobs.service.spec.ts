import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IConfig } from "../config/app.config.js";
import { JobsService } from "./jobs.service.js";

type JobsServiceDeps = ConstructorParameters<typeof JobsService>;

const callPrivate = <T>(target: T, key: string, ...args: unknown[]) => {
  return (target as unknown as Record<string, (...innerArgs: unknown[]) => unknown>)[key](...args);
};

describe("JobsService schedule rows", () => {
  let service: JobsService;
  let storageProviderRepositoryMock: { find: ReturnType<typeof vi.fn> };
  let jobScheduleRepositoryMock: {
    upsertSchedule: ReturnType<typeof vi.fn>;
    deleteSchedulesForInactiveProviders: ReturnType<typeof vi.fn>;
    countPausedSchedules: ReturnType<typeof vi.fn>;
    findDueSchedulesWithManager: ReturnType<typeof vi.fn>;
    runTransaction: ReturnType<typeof vi.fn>;
    acquireAdvisoryLock: ReturnType<typeof vi.fn>;
    releaseAdvisoryLock: ReturnType<typeof vi.fn>;
    updateScheduleAfterRun: ReturnType<typeof vi.fn>;
    countBossJobStates: ReturnType<typeof vi.fn>;
    minBossJobAgeSecondsByState: ReturnType<typeof vi.fn>;
  };
  let metricsMocks: {
    jobsQueuedGauge: JobsServiceDeps[7];
    jobsRetryScheduledGauge: JobsServiceDeps[8];
    oldestQueuedAgeGauge: JobsServiceDeps[9];
    oldestInFlightAgeGauge: JobsServiceDeps[10];
    jobsInFlightGauge: JobsServiceDeps[11];
    jobsEnqueueAttemptsCounter: JobsServiceDeps[12];
    jobsStartedCounter: JobsServiceDeps[13];
    jobsCompletedCounter: JobsServiceDeps[14];
    jobsPausedGauge: JobsServiceDeps[15];
    jobDuration: JobsServiceDeps[16];
  };
  let baseConfigValues: Partial<IConfig>;
  let configService: JobsServiceDeps[0];
  let buildService: (
    overrides?: Partial<{
      configService: JobsServiceDeps[0];
      storageProviderRepository: JobsServiceDeps[1];
      jobScheduleRepository: JobsServiceDeps[2];
      dealService: JobsServiceDeps[3];
      retrievalService: JobsServiceDeps[4];
      metricsSchedulerService: JobsServiceDeps[5];
      walletSdkService: JobsServiceDeps[6];
      jobsQueuedGauge: JobsServiceDeps[7];
      jobsRetryScheduledGauge: JobsServiceDeps[8];
      oldestQueuedAgeGauge: JobsServiceDeps[9];
      oldestInFlightAgeGauge: JobsServiceDeps[10];
      jobsInFlightGauge: JobsServiceDeps[11];
      jobsEnqueueAttemptsCounter: JobsServiceDeps[12];
      jobsStartedCounter: JobsServiceDeps[13];
      jobsCompletedCounter: JobsServiceDeps[14];
      jobsPausedGauge: JobsServiceDeps[15];
      jobDuration: JobsServiceDeps[16];
    }>,
  ) => JobsService;

  beforeEach(() => {
    storageProviderRepositoryMock = {
      find: vi.fn(),
    };

    jobScheduleRepositoryMock = {
      upsertSchedule: vi.fn(),
      deleteSchedulesForInactiveProviders: vi.fn(async () => []),
      countPausedSchedules: vi.fn(async () => []),
      findDueSchedulesWithManager: vi.fn(),
      runTransaction: vi.fn(async (callback: (manager: unknown) => Promise<void>) => {
        await callback({});
      }),
      acquireAdvisoryLock: vi.fn(),
      releaseAdvisoryLock: vi.fn(),
      updateScheduleAfterRun: vi.fn(),
      countBossJobStates: vi.fn(),
      minBossJobAgeSecondsByState: vi.fn(),
    };

    metricsMocks = {
      jobsQueuedGauge: { set: vi.fn() } as unknown as JobsServiceDeps[7],
      jobsRetryScheduledGauge: { set: vi.fn() } as unknown as JobsServiceDeps[8],
      oldestQueuedAgeGauge: { set: vi.fn() } as unknown as JobsServiceDeps[9],
      oldestInFlightAgeGauge: { set: vi.fn() } as unknown as JobsServiceDeps[10],
      jobsInFlightGauge: { set: vi.fn() } as unknown as JobsServiceDeps[11],
      jobsEnqueueAttemptsCounter: { inc: vi.fn() } as unknown as JobsServiceDeps[12],
      jobsStartedCounter: { inc: vi.fn() } as unknown as JobsServiceDeps[13],
      jobsCompletedCounter: { inc: vi.fn() } as unknown as JobsServiceDeps[14],
      jobsPausedGauge: { set: vi.fn() } as unknown as JobsServiceDeps[15],
      jobDuration: { observe: vi.fn() } as unknown as JobsServiceDeps[16],
    };

    baseConfigValues = {
      app: { runMode: "both" } as IConfig["app"],
      blockchain: { useOnlyApprovedProviders: false } as IConfig["blockchain"],
      scheduling: {
        dealIntervalSeconds: 600,
        dealMaxConcurrency: 4,
        retrievalMaxConcurrency: 5,
        retrievalIntervalSeconds: 1200,
      } as IConfig["scheduling"],
      jobs: {
        mode: "pgboss",
        schedulePhaseSeconds: 0,
        catchupMaxEnqueue: 10,
        catchupSpreadHours: 3,
        enqueueJitterSeconds: 0,
        lockRetrySeconds: 60,
        pgbossSchedulerEnabled: true,
        workerPollSeconds: 60,
      } as IConfig["jobs"],
      database: {
        host: "localhost",
        port: 5432,
        username: "user",
        password: "pass",
        database: "dealbot",
      } as IConfig["database"],
    };

    configService = {
      get: vi.fn((key: keyof IConfig) => baseConfigValues[key]),
    } as unknown as JobsServiceDeps[0];

    buildService = (overrides = {}) =>
      new JobsService(
        overrides.configService ?? configService,
        overrides.storageProviderRepository ?? (storageProviderRepositoryMock as unknown as JobsServiceDeps[1]),
        overrides.jobScheduleRepository ?? (jobScheduleRepositoryMock as unknown as JobsServiceDeps[2]),
        overrides.dealService ?? ({} as JobsServiceDeps[3]),
        overrides.retrievalService ?? ({} as JobsServiceDeps[4]),
        overrides.metricsSchedulerService ?? ({} as JobsServiceDeps[5]),
        overrides.walletSdkService ?? ({} as JobsServiceDeps[6]),
        overrides.jobsQueuedGauge ?? metricsMocks.jobsQueuedGauge,
        overrides.jobsRetryScheduledGauge ?? metricsMocks.jobsRetryScheduledGauge,
        overrides.oldestQueuedAgeGauge ?? metricsMocks.oldestQueuedAgeGauge,
        overrides.oldestInFlightAgeGauge ?? metricsMocks.oldestInFlightAgeGauge,
        overrides.jobsInFlightGauge ?? metricsMocks.jobsInFlightGauge,
        overrides.jobsEnqueueAttemptsCounter ?? metricsMocks.jobsEnqueueAttemptsCounter,
        overrides.jobsStartedCounter ?? metricsMocks.jobsStartedCounter,
        overrides.jobsCompletedCounter ?? metricsMocks.jobsCompletedCounter,
        overrides.jobsPausedGauge ?? metricsMocks.jobsPausedGauge,
        overrides.jobDuration ?? metricsMocks.jobDuration,
      );

    service = buildService();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.DEALBOT_DISABLE_CHAIN;
  });

  it("records metrics for successful job execution", async () => {
    const startedCounter = metricsMocks.jobsStartedCounter as unknown as { inc: ReturnType<typeof vi.fn> };
    const completedCounter = metricsMocks.jobsCompletedCounter as unknown as { inc: ReturnType<typeof vi.fn> };
    const durationHistogram = metricsMocks.jobDuration as unknown as { observe: ReturnType<typeof vi.fn> };

    const startTime = new Date("2024-01-01T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(startTime);

    const run = vi.fn(async () => {
      vi.setSystemTime(new Date(startTime.getTime() + 5_000));
      return "success";
    });

    await callPrivate(service, "recordJobExecution", "deal", run);

    expect(run).toHaveBeenCalled();
    expect(startedCounter.inc).toHaveBeenCalledWith({ job_type: "deal" });
    expect(completedCounter.inc).toHaveBeenCalledWith({ job_type: "deal", handler_result: "success" });
    expect(durationHistogram.observe).toHaveBeenCalledWith({ job_type: "deal" }, 5);
  });

  it("records metrics for failed job execution", async () => {
    const startedCounter = metricsMocks.jobsStartedCounter as unknown as { inc: ReturnType<typeof vi.fn> };
    const completedCounter = metricsMocks.jobsCompletedCounter as unknown as { inc: ReturnType<typeof vi.fn> };
    const durationHistogram = metricsMocks.jobDuration as unknown as { observe: ReturnType<typeof vi.fn> };

    const startTime = new Date("2024-01-01T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(startTime);

    const run = vi.fn(async () => {
      vi.setSystemTime(new Date(startTime.getTime() + 2_000));
      throw new Error("boom");
    });

    await expect(callPrivate(service, "recordJobExecution", "deal", run)).rejects.toThrow("boom");

    expect(startedCounter.inc).toHaveBeenCalledWith({ job_type: "deal" });
    expect(completedCounter.inc).toHaveBeenCalledWith({ job_type: "deal", handler_result: "error" });
    expect(durationHistogram.observe).toHaveBeenCalledWith({ job_type: "deal" }, 2);
  });

  it("updates queue metrics from pg-boss state and age queries", async () => {
    const jobsQueuedGauge = metricsMocks.jobsQueuedGauge as unknown as { set: ReturnType<typeof vi.fn> };
    const jobsRetryGauge = metricsMocks.jobsRetryScheduledGauge as unknown as { set: ReturnType<typeof vi.fn> };
    const jobsInFlightGauge = metricsMocks.jobsInFlightGauge as unknown as { set: ReturnType<typeof vi.fn> };
    const oldestQueuedGauge = metricsMocks.oldestQueuedAgeGauge as unknown as { set: ReturnType<typeof vi.fn> };
    const oldestInFlightGauge = metricsMocks.oldestInFlightAgeGauge as unknown as { set: ReturnType<typeof vi.fn> };
    const jobsPausedGauge = metricsMocks.jobsPausedGauge as unknown as { set: ReturnType<typeof vi.fn> };

    jobScheduleRepositoryMock.countBossJobStates.mockResolvedValueOnce([
      { name: "deal.run", state: "created", count: 2 },
      { name: "retrieval.run", state: "active", count: 1 },
      { name: "metrics.run", state: "retry", count: 3 },
      { name: "unknown", state: "created", count: 99 },
    ]);
    jobScheduleRepositoryMock.minBossJobAgeSecondsByState
      .mockResolvedValueOnce([{ name: "deal.run", min_age_seconds: 12 }])
      .mockResolvedValueOnce([{ name: "retrieval.run", min_age_seconds: 34 }]);

    await callPrivate(service, "updateQueueMetrics");

    expect(jobsQueuedGauge.set).toHaveBeenCalledWith({ job_type: "deal" }, 0);
    expect(jobsQueuedGauge.set).toHaveBeenCalledWith({ job_type: "retrieval" }, 0);
    expect(jobsQueuedGauge.set).toHaveBeenCalledWith({ job_type: "metrics" }, 0);
    expect(jobsQueuedGauge.set).toHaveBeenCalledWith({ job_type: "metrics_cleanup" }, 0);

    expect(jobsRetryGauge.set).toHaveBeenCalledWith({ job_type: "metrics" }, 3);
    expect(jobsInFlightGauge.set).toHaveBeenCalledWith({ job_type: "retrieval" }, 1);
    expect(jobsQueuedGauge.set).toHaveBeenCalledWith({ job_type: "deal" }, 2);

    expect(oldestQueuedGauge.set).toHaveBeenCalledWith({ job_type: "deal" }, 12);
    expect(oldestInFlightGauge.set).toHaveBeenCalledWith({ job_type: "retrieval" }, 34);
    expect(jobsPausedGauge.set).toHaveBeenCalledWith({ job_type: "deal" }, 0);
  });

  it("registers pg-boss workers with per-queue batch sizes", async () => {
    const work = vi.fn().mockResolvedValue(undefined);
    (service as unknown as { boss: { work: typeof work } }).boss = { work };

    callPrivate(service, "registerWorkers");

    expect(work).toHaveBeenCalledWith("deal.run", { batchSize: 4, pollingIntervalSeconds: 60 }, expect.any(Function));
    expect(work).toHaveBeenCalledWith(
      "retrieval.run",
      { batchSize: 5, pollingIntervalSeconds: 60 },
      expect.any(Function),
    );
    expect(work).toHaveBeenCalledWith(
      "metrics.run",
      { batchSize: 1, pollingIntervalSeconds: 60 },
      expect.any(Function),
    );
    expect(work).toHaveBeenCalledWith(
      "metrics.cleanup",
      { batchSize: 1, pollingIntervalSeconds: 60 },
      expect.any(Function),
    );
  });

  it("skips registering workers in api mode", async () => {
    baseConfigValues = {
      ...baseConfigValues,
      app: { runMode: "api" } as IConfig["app"],
    };
    const registerWorkers = vi.fn();
    const tick = vi.fn().mockResolvedValue(undefined);
    const startBoss = vi.fn().mockImplementation(async () => {
      (service as unknown as { boss: object }).boss = {};
    });
    vi.spyOn(global, "setInterval").mockReturnValue(0 as unknown as ReturnType<typeof setInterval>);

    service = buildService();
    (service as unknown as { registerWorkers: typeof registerWorkers }).registerWorkers = registerWorkers;
    (service as unknown as { tick: typeof tick }).tick = tick;
    (service as unknown as { startBoss: typeof startBoss }).startBoss = startBoss;
    process.env.DEALBOT_DISABLE_CHAIN = "true";

    await service.onModuleInit();

    expect(registerWorkers).not.toHaveBeenCalled();
    expect(tick).toHaveBeenCalled();
    expect(setInterval).toHaveBeenCalled();
  });

  it("skips scheduler loop in worker mode", async () => {
    baseConfigValues = {
      ...baseConfigValues,
      app: { runMode: "worker" } as IConfig["app"],
    };
    const registerWorkers = vi.fn();
    const tick = vi.fn().mockResolvedValue(undefined);
    const startBoss = vi.fn().mockImplementation(async () => {
      (service as unknown as { boss: object }).boss = {};
    });
    vi.spyOn(global, "setInterval").mockReturnValue(0 as unknown as ReturnType<typeof setInterval>);

    service = buildService();
    (service as unknown as { registerWorkers: typeof registerWorkers }).registerWorkers = registerWorkers;
    (service as unknown as { tick: typeof tick }).tick = tick;
    (service as unknown as { startBoss: typeof startBoss }).startBoss = startBoss;
    process.env.DEALBOT_DISABLE_CHAIN = "true";

    await service.onModuleInit();

    expect(registerWorkers).toHaveBeenCalled();
    expect(tick).not.toHaveBeenCalled();
    expect(setInterval).not.toHaveBeenCalled();
  });

  it("registers workers but skips scheduler when disabled in both mode", async () => {
    baseConfigValues = {
      ...baseConfigValues,
      app: { runMode: "both" } as IConfig["app"],
      jobs: {
        ...baseConfigValues.jobs,
        pgbossSchedulerEnabled: false,
      } as IConfig["jobs"],
    };
    const registerWorkers = vi.fn();
    const tick = vi.fn().mockResolvedValue(undefined);
    const startBoss = vi.fn().mockImplementation(async () => {
      (service as unknown as { boss: object }).boss = {};
    });
    vi.spyOn(global, "setInterval").mockReturnValue(0 as unknown as ReturnType<typeof setInterval>);

    service = buildService();
    (service as unknown as { registerWorkers: typeof registerWorkers }).registerWorkers = registerWorkers;
    (service as unknown as { tick: typeof tick }).tick = tick;
    (service as unknown as { startBoss: typeof startBoss }).startBoss = startBoss;
    process.env.DEALBOT_DISABLE_CHAIN = "true";

    await service.onModuleInit();

    expect(registerWorkers).toHaveBeenCalled();
    expect(tick).not.toHaveBeenCalled();
    expect(setInterval).not.toHaveBeenCalled();
  });

  it("updates paused job metrics from paused schedule counts", async () => {
    const jobsPausedGauge = metricsMocks.jobsPausedGauge as unknown as { set: ReturnType<typeof vi.fn> };

    jobScheduleRepositoryMock.countBossJobStates.mockResolvedValueOnce([]);
    jobScheduleRepositoryMock.countPausedSchedules.mockResolvedValueOnce([{ job_type: "deal", count: 2 }]);
    jobScheduleRepositoryMock.minBossJobAgeSecondsByState.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await callPrivate(service, "updateQueueMetrics");

    expect(jobsPausedGauge.set).toHaveBeenCalledWith({ job_type: "deal" }, 2);
  });

  it("maps job names to job types", async () => {
    expect(callPrivate(service, "mapJobTypeFromName", "deal.run")).toBe("deal");
    expect(callPrivate(service, "mapJobTypeFromName", "unknown.job")).toBeNull();
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

  it("deletes schedule rows for providers no longer present", async () => {
    const providerA = { address: "0xaaa" };
    storageProviderRepositoryMock.find.mockResolvedValueOnce([providerA]);

    await callPrivate(service, "ensureScheduleRows");

    expect(jobScheduleRepositoryMock.deleteSchedulesForInactiveProviders).toHaveBeenCalledWith([providerA.address]);
  });

  it("does not delete schedule rows when no active providers exist", async () => {
    storageProviderRepositoryMock.find.mockResolvedValueOnce([]);

    await callPrivate(service, "ensureScheduleRows");

    expect(jobScheduleRepositoryMock.deleteSchedulesForInactiveProviders).not.toHaveBeenCalled();
  });

  it("uses approved-only filter when configured", async () => {
    baseConfigValues = {
      ...baseConfigValues,
      blockchain: { useOnlyApprovedProviders: true } as IConfig["blockchain"],
    };
    configService = {
      get: vi.fn((key: keyof IConfig) => baseConfigValues[key]),
    } as unknown as JobsServiceDeps[0];

    service = buildService({ configService });

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
    configService = {
      get: vi.fn((key: keyof IConfig) => baseConfigValues[key]),
    } as unknown as JobsServiceDeps[0];

    service = buildService({ configService });

    const send = vi.fn();
    (service as unknown as { boss: { send: typeof send } }).boss = { send };

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

    expect(send).toHaveBeenCalledTimes(3);
    const startAfters = send.mock.calls.map((call) => call[2]?.startAfter as Date);
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
    configService = {
      get: vi.fn((key: keyof IConfig) => baseConfigValues[key]),
    } as unknown as JobsServiceDeps[0];

    service = buildService({ configService });

    const send = vi.fn();
    (service as unknown as { boss: { send: typeof send } }).boss = { send };

    jobScheduleRepositoryMock.acquireAdvisoryLock.mockResolvedValueOnce(false);

    const now = new Date("2024-01-01T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    await callPrivate(service, "handleDealJob", { spAddress: "0xaaa", intervalSeconds: 60 });

    expect(send).toHaveBeenCalledTimes(1);
    const startAfter = send.mock.calls[0][2]?.startAfter as Date;
    expect(startAfter.getTime()).toBeGreaterThanOrEqual(now.getTime() + 10_000);

    vi.useRealTimers();
  });

  it("requeues retrieval job when lock cannot be acquired (preventing concurrent execution)", async () => {
    baseConfigValues = {
      ...baseConfigValues,
      jobs: {
        ...baseConfigValues.jobs,
        lockRetrySeconds: 10,
      } as IConfig["jobs"],
    };
    configService = {
      get: vi.fn((key: keyof IConfig) => baseConfigValues[key]),
    } as unknown as JobsServiceDeps[0];

    service = buildService({ configService });

    const send = vi.fn();
    (service as unknown as { boss: { send: typeof send } }).boss = { send };

    // Simulate lock being held (e.g. by a running deal execution)
    jobScheduleRepositoryMock.acquireAdvisoryLock.mockResolvedValueOnce(false);

    const now = new Date("2024-01-01T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const spAddress = "0xccc";
    await callPrivate(service, "handleRetrievalJob", { spAddress, intervalSeconds: 60 });

    // Ensure we tried to acquire the lock for the specific SP
    expect(jobScheduleRepositoryMock.acquireAdvisoryLock).toHaveBeenCalledWith(spAddress);

    // Should requeue instead of running
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      "retrieval.run",
      expect.objectContaining({ spAddress }),
      expect.objectContaining({ startAfter: expect.any(Date) }),
    );

    const startAfter = send.mock.calls[0][2]?.startAfter as Date;
    expect(startAfter.getTime()).toBeGreaterThanOrEqual(now.getTime() + 10_000);

    vi.useRealTimers();
  });
});
