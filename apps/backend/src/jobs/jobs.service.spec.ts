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
    updateScheduleAfterRun: ReturnType<typeof vi.fn>;
    countBossJobStates: ReturnType<typeof vi.fn>;
    minBossJobAgeSecondsByState: ReturnType<typeof vi.fn>;
  };
  let dataRetentionServiceMock: { pollDataRetention: ReturnType<typeof vi.fn> };
  let metricsMocks: {
    jobsQueuedGauge: JobsServiceDeps[8];
    jobsRetryScheduledGauge: JobsServiceDeps[9];
    oldestQueuedAgeGauge: JobsServiceDeps[10];
    oldestInFlightAgeGauge: JobsServiceDeps[11];
    jobsInFlightGauge: JobsServiceDeps[12];
    jobsEnqueueAttemptsCounter: JobsServiceDeps[13];
    jobsStartedCounter: JobsServiceDeps[14];
    jobsCompletedCounter: JobsServiceDeps[15];
    jobsPausedGauge: JobsServiceDeps[16];
    jobDuration: JobsServiceDeps[17];
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
      dataRetentionService: JobsServiceDeps[7];
      jobsQueuedGauge: JobsServiceDeps[8];
      jobsRetryScheduledGauge: JobsServiceDeps[9];
      oldestQueuedAgeGauge: JobsServiceDeps[10];
      oldestInFlightAgeGauge: JobsServiceDeps[11];
      jobsInFlightGauge: JobsServiceDeps[12];
      jobsEnqueueAttemptsCounter: JobsServiceDeps[13];
      jobsStartedCounter: JobsServiceDeps[14];
      jobsCompletedCounter: JobsServiceDeps[15];
      jobsPausedGauge: JobsServiceDeps[16];
      jobDuration: JobsServiceDeps[17];
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
      updateScheduleAfterRun: vi.fn(),
      countBossJobStates: vi.fn(),
      minBossJobAgeSecondsByState: vi.fn(),
    };

    dataRetentionServiceMock = {
      pollDataRetention: vi.fn(),
    };

    metricsMocks = {
      jobsQueuedGauge: { set: vi.fn() } as unknown as JobsServiceDeps[8],
      jobsRetryScheduledGauge: { set: vi.fn() } as unknown as JobsServiceDeps[9],
      oldestQueuedAgeGauge: { set: vi.fn() } as unknown as JobsServiceDeps[10],
      oldestInFlightAgeGauge: { set: vi.fn() } as unknown as JobsServiceDeps[11],
      jobsInFlightGauge: { set: vi.fn() } as unknown as JobsServiceDeps[12],
      jobsEnqueueAttemptsCounter: { inc: vi.fn() } as unknown as JobsServiceDeps[13],
      jobsStartedCounter: { inc: vi.fn() } as unknown as JobsServiceDeps[14],
      jobsCompletedCounter: { inc: vi.fn() } as unknown as JobsServiceDeps[15],
      jobsPausedGauge: { set: vi.fn() } as unknown as JobsServiceDeps[16],
      jobDuration: { observe: vi.fn() } as unknown as JobsServiceDeps[17],
    };

    baseConfigValues = {
      app: { runMode: "both" } as IConfig["app"],
      blockchain: { useOnlyApprovedProviders: false } as IConfig["blockchain"],
      scheduling: {
        dealIntervalSeconds: 600,
        retrievalIntervalSeconds: 1200,
        dataRetentionPollIntervalSeconds: 3600,
        maintenanceWindowsUtc: ["07:00", "22:00"],
        maintenanceWindowMinutes: 20,
      } as IConfig["scheduling"],
      jobs: {
        mode: "pgboss",
        schedulePhaseSeconds: 0,
        catchupMaxEnqueue: 10,
        pgbossLocalConcurrency: 9,
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
        overrides.dataRetentionService ?? (dataRetentionServiceMock as unknown as JobsServiceDeps[7]),
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

  it("records metrics for aborted job execution", async () => {
    const startedCounter = metricsMocks.jobsStartedCounter as unknown as { inc: ReturnType<typeof vi.fn> };
    const completedCounter = metricsMocks.jobsCompletedCounter as unknown as { inc: ReturnType<typeof vi.fn> };
    const durationHistogram = metricsMocks.jobDuration as unknown as { observe: ReturnType<typeof vi.fn> };

    const startTime = new Date("2024-01-01T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(startTime);

    const run = vi.fn(async () => {
      vi.setSystemTime(new Date(startTime.getTime() + 3_000));
      return "aborted" as const;
    });

    await callPrivate(service, "recordJobExecution", "deal", run);

    expect(startedCounter.inc).toHaveBeenCalledWith({ job_type: "deal" });
    expect(completedCounter.inc).toHaveBeenCalledWith({ job_type: "deal", handler_result: "aborted" });
    expect(durationHistogram.observe).toHaveBeenCalledWith({ job_type: "deal" }, 3);
  });

  it("deal job records aborted when abort signal fires", async () => {
    const completedCounter = metricsMocks.jobsCompletedCounter as unknown as { inc: ReturnType<typeof vi.fn> };

    baseConfigValues = {
      ...baseConfigValues,
      jobs: {
        ...baseConfigValues.jobs,
        dealJobTimeoutSeconds: 1,
      } as IConfig["jobs"],
    };
    configService = {
      get: vi.fn((key: keyof IConfig) => baseConfigValues[key]),
    } as unknown as JobsServiceDeps[0];

    const dealService = {
      createDealForProvider: vi.fn(async (_provider: unknown, opts: { signal: AbortSignal }) => {
        // Wait for the abort signal to fire before throwing
        await new Promise<void>((resolve) => {
          if (opts.signal.aborted) return resolve();
          opts.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        throw new Error("The operation was aborted");
      }),
      getTestingDealOptions: vi.fn(() => ({})),
    };

    const walletSdkService = {
      getTestingProviders: vi.fn(() => [{ serviceProvider: "0xaaa" }]),
      ensureWalletAllowances: vi.fn(),
      loadProviders: vi.fn(),
    };

    service = buildService({
      configService,
      dealService: dealService as unknown as ConstructorParameters<typeof JobsService>[3],
      walletSdkService: walletSdkService as unknown as ConstructorParameters<typeof JobsService>[6],
    });

    // Trigger the timeout immediately by using fake timers
    vi.useFakeTimers();
    const now = new Date("2024-01-01T00:00:00Z");
    vi.setSystemTime(now);

    const jobPromise = callPrivate(service, "handleDealJob", {
      id: "job-123",
      data: {
        jobType: "deal",
        spAddress: "0xaaa",
        intervalSeconds: 60,
      },
    });

    // Advance past the timeout to trigger the abort
    await vi.advanceTimersByTimeAsync(120_000);
    await jobPromise;

    expect(completedCounter.inc).toHaveBeenCalledWith({ job_type: "deal", handler_result: "aborted" });
  });

  it("retrieval job records aborted when abort signal fires", async () => {
    const completedCounter = metricsMocks.jobsCompletedCounter as unknown as { inc: ReturnType<typeof vi.fn> };

    baseConfigValues = {
      ...baseConfigValues,
      jobs: {
        ...baseConfigValues.jobs,
        retrievalJobTimeoutSeconds: 1,
      } as IConfig["jobs"],
      timeouts: {
        httpRequestTimeoutMs: 5000,
        http2RequestTimeoutMs: 5000,
      } as IConfig["timeouts"],
    };
    configService = {
      get: vi.fn((key: keyof IConfig) => baseConfigValues[key]),
    } as unknown as JobsServiceDeps[0];

    const retrievalService = {
      performRandomRetrievalForProvider: vi.fn(async (_sp: string, signal: AbortSignal) => {
        await new Promise<void>((resolve) => {
          if (signal.aborted) return resolve();
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        throw new Error("The operation was aborted");
      }),
    };

    service = buildService({
      configService,
      retrievalService: retrievalService as unknown as ConstructorParameters<typeof JobsService>[4],
    });

    vi.useFakeTimers();
    const now = new Date("2024-01-01T00:00:00Z");
    vi.setSystemTime(now);

    const jobPromise = callPrivate(service, "handleRetrievalJob", {
      id: "job-456",
      data: {
        jobType: "retrieval",
        spAddress: "0xaaa",
        intervalSeconds: 60,
      },
    });

    await vi.advanceTimersByTimeAsync(60_000);
    await jobPromise;

    expect(completedCounter.inc).toHaveBeenCalledWith({ job_type: "retrieval", handler_result: "aborted" });
  });

  it("updates queue metrics from pg-boss state and age queries", async () => {
    const jobsQueuedGauge = metricsMocks.jobsQueuedGauge as unknown as { set: ReturnType<typeof vi.fn> };
    const jobsRetryGauge = metricsMocks.jobsRetryScheduledGauge as unknown as { set: ReturnType<typeof vi.fn> };
    const jobsInFlightGauge = metricsMocks.jobsInFlightGauge as unknown as { set: ReturnType<typeof vi.fn> };
    const oldestQueuedGauge = metricsMocks.oldestQueuedAgeGauge as unknown as { set: ReturnType<typeof vi.fn> };
    const oldestInFlightGauge = metricsMocks.oldestInFlightAgeGauge as unknown as { set: ReturnType<typeof vi.fn> };
    const jobsPausedGauge = metricsMocks.jobsPausedGauge as unknown as { set: ReturnType<typeof vi.fn> };

    jobScheduleRepositoryMock.countBossJobStates.mockResolvedValueOnce([
      { job_type: "deal", state: "created", count: 2 },
      { job_type: "retrieval", state: "active", count: 1 },
      { job_type: "metrics", state: "retry", count: 3 },
      { job_type: "unknown", state: "created", count: 99 },
    ]);
    jobScheduleRepositoryMock.minBossJobAgeSecondsByState
      .mockResolvedValueOnce([{ job_type: "deal", min_age_seconds: 12 }])
      .mockResolvedValueOnce([{ job_type: "retrieval", min_age_seconds: 34 }]);

    await callPrivate(service, "updateQueueMetrics");

    expect(jobsQueuedGauge.set).toHaveBeenCalledWith({ job_type: "deal" }, 0);
    expect(jobsQueuedGauge.set).toHaveBeenCalledWith({ job_type: "retrieval" }, 0);
    expect(jobsQueuedGauge.set).toHaveBeenCalledWith({ job_type: "metrics" }, 0);
    expect(jobsQueuedGauge.set).toHaveBeenCalledWith({ job_type: "metrics_cleanup" }, 0);
    expect(jobsQueuedGauge.set).toHaveBeenCalledWith({ job_type: "data_retention_poll" }, 0);

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

    expect(work).toHaveBeenCalledWith(
      "sp.work",
      { batchSize: 1, localConcurrency: 9, pollingIntervalSeconds: 60 },
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
    expect(work).toHaveBeenCalledWith(
      "data.retention.poll",
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

  it("always inserts global metrics and providers refresh schedules", async () => {
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
    expect(jobScheduleRepositoryMock.upsertSchedule).toHaveBeenCalledWith(
      "providers_refresh",
      "",
      expect.any(Number),
      expect.any(Date),
    );
    expect(jobScheduleRepositoryMock.upsertSchedule).toHaveBeenCalledWith(
      "data_retention_poll",
      "",
      expect.any(Number),
      expect.any(Date),
    );
  });

  it("caps catch-up enqueue count", async () => {
    baseConfigValues = {
      ...baseConfigValues,
      jobs: {
        ...baseConfigValues.jobs,
        catchupMaxEnqueue: 3,
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
    for (const call of send.mock.calls) {
      expect(call[0]).toBe("sp.work");
      expect(call[1]).toMatchObject({ jobType: "deal", spAddress: "0xaaa" });
      expect(call[2]).toMatchObject({ singletonKey: "0xaaa", retryLimit: 0 });
      expect(call[2]?.startAfter).toBeUndefined();
    }

    // Check update call
    expect(jobScheduleRepositoryMock.updateScheduleAfterRun).toHaveBeenCalled();
  });

  it("defers jobs until maintenance window ends (same-day)", async () => {
    baseConfigValues = {
      ...baseConfigValues,
      scheduling: {
        ...baseConfigValues.scheduling,
        maintenanceWindowsUtc: ["07:00"],
        maintenanceWindowMinutes: 20,
      } as IConfig["scheduling"],
    };
    configService = {
      get: vi.fn((key: keyof IConfig) => baseConfigValues[key]),
    } as unknown as JobsServiceDeps[0];

    service = buildService({ configService });

    const safeSend = vi.fn().mockResolvedValue(true);
    (service as unknown as { safeSend: typeof safeSend }).safeSend = safeSend;

    const now = new Date("2024-01-01T07:05:00Z");
    const maintenance = callPrivate(service, "getMaintenanceWindowStatus", now) as any;

    await callPrivate(
      service,
      "deferJobForMaintenance",
      "deal",
      { jobType: "deal", spAddress: "0xaaa", intervalSeconds: 60 },
      maintenance,
      now,
    );

    const expectedResumeAt = new Date("2024-01-01T07:20:00Z");
    expect(safeSend).toHaveBeenCalledWith(
      "deal",
      "sp.work",
      { jobType: "deal", spAddress: "0xaaa", intervalSeconds: 60 },
      { startAfter: expectedResumeAt },
    );
  });

  it("defers jobs until maintenance window ends (wraps midnight)", async () => {
    baseConfigValues = {
      ...baseConfigValues,
      scheduling: {
        ...baseConfigValues.scheduling,
        maintenanceWindowsUtc: ["23:50"],
        maintenanceWindowMinutes: 20,
      } as IConfig["scheduling"],
    };
    configService = {
      get: vi.fn((key: keyof IConfig) => baseConfigValues[key]),
    } as unknown as JobsServiceDeps[0];

    service = buildService({ configService });

    const safeSend = vi.fn().mockResolvedValue(true);
    (service as unknown as { safeSend: typeof safeSend }).safeSend = safeSend;

    const now = new Date("2024-01-01T23:55:00Z");
    const maintenance = callPrivate(service, "getMaintenanceWindowStatus", now) as any;

    await callPrivate(
      service,
      "deferJobForMaintenance",
      "retrieval",
      { jobType: "retrieval", spAddress: "0xbbb", intervalSeconds: 60 },
      maintenance,
      now,
    );

    const expectedResumeAt = new Date("2024-01-02T00:10:00Z");
    expect(safeSend).toHaveBeenCalledWith(
      "retrieval",
      "sp.work",
      { jobType: "retrieval", spAddress: "0xbbb", intervalSeconds: 60 },
      { startAfter: expectedResumeAt },
    );
  });
});
