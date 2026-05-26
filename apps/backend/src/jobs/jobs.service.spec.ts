import { Network } from "src/common/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DealJobTerminatedDataSetError } from "../common/errors.js";
import type { IConfig, INetworkConfig, INetworksConfig } from "../config/types.js";
import {
  DATA_RETENTION_POLL_QUEUE,
  PROVIDERS_REFRESH_QUEUE,
  PULL_PIECE_CLEANUP_QUEUE,
  SP_WORK_QUEUE,
} from "./job-queues.js";
import { JobsService } from "./jobs.service.js";

const DEFAULT_NETWORK = "calibration";

type JobsServiceDeps = ConstructorParameters<typeof JobsService>;

const callPrivate = <T>(target: T, key: string, ...args: unknown[]) => {
  return (target as unknown as Record<string, (...innerArgs: unknown[]) => unknown>)[key](...args);
};

describe("JobsService schedule rows", () => {
  let service: JobsService;
  let storageProviderRepositoryMock: {
    find: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  let jobScheduleRepositoryMock: {
    upsertSchedule: ReturnType<typeof vi.fn>;
    deleteSchedulesForInactiveProviders: ReturnType<typeof vi.fn>;
    countPausedSchedules: ReturnType<typeof vi.fn>;
    findDueSchedulesWithManager: ReturnType<typeof vi.fn>;
    runTransaction: ReturnType<typeof vi.fn>;
    updateScheduleAfterRun: ReturnType<typeof vi.fn>;
    advanceScheduleNextRun: ReturnType<typeof vi.fn>;
    countBossJobStates: ReturnType<typeof vi.fn>;
    minBossJobAgeSecondsByState: ReturnType<typeof vi.fn>;
  };
  let dataRetentionServiceMock: { pollDataRetention: ReturnType<typeof vi.fn> };
  let metricsMocks: {
    jobsQueuedGauge: JobsServiceDeps[9];
    jobsRetryScheduledGauge: JobsServiceDeps[10];
    oldestQueuedAgeGauge: JobsServiceDeps[11];
    oldestInFlightAgeGauge: JobsServiceDeps[12];
    jobsInFlightGauge: JobsServiceDeps[13];
    jobsEnqueueAttemptsCounter: JobsServiceDeps[14];
    jobsStartedCounter: JobsServiceDeps[15];
    jobsCompletedCounter: JobsServiceDeps[16];
    jobsPausedGauge: JobsServiceDeps[17];
    jobDuration: JobsServiceDeps[18];
    storageProvidersActive: JobsServiceDeps[19];
    storageProvidersTested: JobsServiceDeps[20];
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
      walletSdkService: JobsServiceDeps[5];
      dataRetentionService: JobsServiceDeps[6];
      pieceCleanupService: JobsServiceDeps[7];
      pullCheckService: JobsServiceDeps[8];
      jobsQueuedGauge: JobsServiceDeps[9];
      jobsRetryScheduledGauge: JobsServiceDeps[10];
      oldestQueuedAgeGauge: JobsServiceDeps[11];
      oldestInFlightAgeGauge: JobsServiceDeps[12];
      jobsInFlightGauge: JobsServiceDeps[13];
      jobsEnqueueAttemptsCounter: JobsServiceDeps[14];
      jobsStartedCounter: JobsServiceDeps[15];
      jobsCompletedCounter: JobsServiceDeps[16];
      jobsPausedGauge: JobsServiceDeps[17];
      jobDuration: JobsServiceDeps[18];
      storageProvidersActive: JobsServiceDeps[19];
      storageProvidersTested: JobsServiceDeps[20];
    }>,
  ) => JobsService;

  beforeEach(() => {
    storageProviderRepositoryMock = {
      find: vi.fn(),
      findOne: vi.fn(),
      count: vi.fn(),
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
      advanceScheduleNextRun: vi.fn(),
      countBossJobStates: vi.fn(),
      minBossJobAgeSecondsByState: vi.fn(),
    };

    dataRetentionServiceMock = {
      pollDataRetention: vi.fn(),
    };

    metricsMocks = {
      jobsQueuedGauge: { set: vi.fn() } as unknown as JobsServiceDeps[9],
      jobsRetryScheduledGauge: { set: vi.fn() } as unknown as JobsServiceDeps[10],
      oldestQueuedAgeGauge: { set: vi.fn() } as unknown as JobsServiceDeps[11],
      oldestInFlightAgeGauge: { set: vi.fn() } as unknown as JobsServiceDeps[12],
      jobsInFlightGauge: { set: vi.fn() } as unknown as JobsServiceDeps[13],
      jobsEnqueueAttemptsCounter: { inc: vi.fn() } as unknown as JobsServiceDeps[14],
      jobsStartedCounter: { inc: vi.fn() } as unknown as JobsServiceDeps[15],
      jobsCompletedCounter: { inc: vi.fn() } as unknown as JobsServiceDeps[16],
      jobsPausedGauge: { set: vi.fn() } as unknown as JobsServiceDeps[17],
      jobDuration: { observe: vi.fn() } as unknown as JobsServiceDeps[18],
      storageProvidersActive: { set: vi.fn() } as unknown as JobsServiceDeps[19],
      storageProvidersTested: { set: vi.fn() } as unknown as JobsServiceDeps[20],
    };

    const baseNetworkConfig = {
      walletPrivateKey: "0x",
      network: DEFAULT_NETWORK,
      useOnlyApprovedProviders: false,
      minNumDataSetsForChecks: 1,
      dealsPerSpPerHour: 4,
      retrievalsPerSpPerHour: 2,
      dataSetCreationsPerSpPerHour: 1,
      dataRetentionPollIntervalSeconds: 3600,
      providersRefreshIntervalSeconds: 14400,
      walletAddress: "0x0000000000000000000000000000000000000000",
      checkDatasetCreationFees: true,
      maintenanceWindowsUtc: ["07:00", "22:00"],
      maintenanceWindowMinutes: 20,
      blockedSpIds: new Set(),
      blockedSpAddresses: new Set(),
      pieceCleanupPerSpPerHour: 1,
      maxPieceCleanupRuntimeSeconds: 300,
      maxDatasetStorageSizeBytes: 24 * 1024 * 1024 * 1024,
      targetDatasetStorageSizeBytes: 20 * 1024 * 1024 * 1024,
      dealJobTimeoutSeconds: 360,
      dataSetCreationJobTimeoutSeconds: 300,
      retrievalJobTimeoutSeconds: 60,
      pullChecksPerSpPerHour: 1,
      pullCheckJobTimeoutSeconds: 300,
      pullCheckPollIntervalSeconds: 2,
      pullCheckPieceSizeBytes: 10 * 1024 * 1024,
      pullPieceCleanupIntervalSeconds: 7 * 24 * 3600,
    } satisfies IConfig["networks"]["calibration"];

    baseConfigValues = {
      app: { runMode: "both" } as IConfig["app"],
      activeNetworks: [DEFAULT_NETWORK] as IConfig["activeNetworks"],
      networks: { calibration: baseNetworkConfig } as unknown as IConfig["networks"],
      jobs: {
        schedulePhaseSeconds: 0,
        catchupMaxEnqueue: 10,
        pgbossLocalConcurrency: 9,
        pgbossSchedulerEnabled: true,
        workerPollSeconds: 60,
        shutdownFinalScrapeDelaySeconds: 35,
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
        overrides.walletSdkService ?? ({} as JobsServiceDeps[5]),
        overrides.dataRetentionService ?? (dataRetentionServiceMock as unknown as JobsServiceDeps[6]),
        overrides.pieceCleanupService ?? ({} as JobsServiceDeps[7]),
        overrides.pullCheckService ?? ({} as JobsServiceDeps[8]),
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
        overrides.storageProvidersActive ?? metricsMocks.storageProvidersActive,
        overrides.storageProvidersTested ?? metricsMocks.storageProvidersTested,
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

    await callPrivate(service, "recordJobExecution", "deal", DEFAULT_NETWORK, run);

    expect(run).toHaveBeenCalled();
    expect(startedCounter.inc).toHaveBeenCalledWith({ job_type: "deal", network: DEFAULT_NETWORK });
    expect(completedCounter.inc).toHaveBeenCalledWith({
      job_type: "deal",
      handler_result: "success",
      network: DEFAULT_NETWORK,
    });
    expect(durationHistogram.observe).toHaveBeenCalledWith({ job_type: "deal", network: DEFAULT_NETWORK }, 5);
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

    await expect(callPrivate(service, "recordJobExecution", "deal", DEFAULT_NETWORK, run)).rejects.toThrow("boom");

    expect(startedCounter.inc).toHaveBeenCalledWith({ job_type: "deal", network: DEFAULT_NETWORK });
    expect(completedCounter.inc).toHaveBeenCalledWith({
      job_type: "deal",
      handler_result: "error",
      network: DEFAULT_NETWORK,
    });
    expect(durationHistogram.observe).toHaveBeenCalledWith({ job_type: "deal", network: DEFAULT_NETWORK }, 2);
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

    await callPrivate(service, "recordJobExecution", "deal", DEFAULT_NETWORK, run);

    expect(startedCounter.inc).toHaveBeenCalledWith({ job_type: "deal", network: DEFAULT_NETWORK });
    expect(completedCounter.inc).toHaveBeenCalledWith({
      job_type: "deal",
      handler_result: "aborted",
      network: DEFAULT_NETWORK,
    });
    expect(durationHistogram.observe).toHaveBeenCalledWith({ job_type: "deal", network: DEFAULT_NETWORK }, 3);
  });

  it("deal job records aborted when abort signal fires", async () => {
    const completedCounter = metricsMocks.jobsCompletedCounter as unknown as { inc: ReturnType<typeof vi.fn> };

    baseConfigValues = {
      ...baseConfigValues,
      networks: {
        calibration: { ...(baseConfigValues.networks as any).calibration, dealJobTimeoutSeconds: 1 },
      } as unknown as IConfig["networks"],
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
      getBaseDataSetMetadata: vi.fn(() => ({})),
    };

    const walletSdkService = {
      getTestingProviders: vi.fn(() => [{ serviceProvider: "0xaaa" }]),
      ensureWalletAllowances: vi.fn(),
      loadProviders: vi.fn(),
      getProviderInfo: vi.fn(() => ({ id: 1, name: "test-provider" })),
    };

    service = buildService({
      configService,
      dealService: dealService as unknown as ConstructorParameters<typeof JobsService>[3],
      walletSdkService: walletSdkService as unknown as ConstructorParameters<typeof JobsService>[5],
    });

    // Trigger the timeout immediately by using fake timers
    vi.useFakeTimers();
    const now = new Date("2024-01-01T00:00:00Z");
    vi.setSystemTime(now);

    const jobPromise = callPrivate(service, "handleDealJob", {
      id: "job-123",
      data: {
        network: DEFAULT_NETWORK,
        jobType: "deal",
        spAddress: "0xaaa",
        intervalSeconds: 60,
      },
    });

    // Advance past the timeout to trigger the abort
    await vi.advanceTimersByTimeAsync(120_000);
    await jobPromise;

    expect(completedCounter.inc).toHaveBeenCalledWith({
      job_type: "deal",
      handler_result: "aborted",
      network: DEFAULT_NETWORK,
    });
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
      performRandomRetrievalForProvider: vi.fn(async (_sp: string, _network: Network, signal: AbortSignal) => {
        await new Promise<void>((resolve) => {
          if (signal.aborted) return resolve();
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        throw new Error("The operation was aborted");
      }),
    };

    const walletSdkService = {
      getProviderInfo: vi.fn(() => ({ id: 2, name: "test-provider-2" })),
    };

    service = buildService({
      configService,
      retrievalService: retrievalService as unknown as ConstructorParameters<typeof JobsService>[4],
      walletSdkService: walletSdkService as unknown as ConstructorParameters<typeof JobsService>[5],
    });

    vi.useFakeTimers();
    const now = new Date("2024-01-01T00:00:00Z");
    vi.setSystemTime(now);

    const jobPromise = callPrivate(service, "handleRetrievalJob", {
      id: "job-456",
      data: {
        jobType: "retrieval",
        spAddress: "0xaaa",
        network: DEFAULT_NETWORK,
        intervalSeconds: 60,
      },
    });

    await vi.advanceTimersByTimeAsync(60_000);
    await jobPromise;

    expect(completedCounter.inc).toHaveBeenCalledWith({
      job_type: "retrieval",
      handler_result: "aborted",
      network: DEFAULT_NETWORK,
    });
  });

  it("retrieval job resolves providerId from storage_providers when wallet cache misses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    const retrievalService = {
      performRandomRetrievalForProvider: vi.fn(async () => []),
    };
    const walletSdkService = {
      getProviderInfo: vi.fn(() => undefined),
      loadProviders: vi.fn(async () => undefined),
    };
    storageProviderRepositoryMock.findOne.mockResolvedValue({
      providerId: 42,
      name: "db-provider",
    });

    service = buildService({
      retrievalService: retrievalService as unknown as ConstructorParameters<typeof JobsService>[4],
      walletSdkService: walletSdkService as unknown as ConstructorParameters<typeof JobsService>[5],
    });

    await callPrivate(service, "handleRetrievalJob", {
      id: "job-retrieval-provider-fallback",
      data: {
        jobType: "retrieval",
        spAddress: "0xaaa",
        network: DEFAULT_NETWORK,
        intervalSeconds: 60,
      },
    });

    expect(retrievalService.performRandomRetrievalForProvider).toHaveBeenCalledWith(
      "0xaaa",
      DEFAULT_NETWORK,
      expect.any(AbortSignal),
      expect.objectContaining({
        jobId: "job-retrieval-provider-fallback",
        providerAddress: "0xaaa",
        providerId: 42,
      }),
    );
  });

  it("retrieval job fails fast when providerId cannot be resolved", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    const completedCounter = metricsMocks.jobsCompletedCounter as unknown as { inc: ReturnType<typeof vi.fn> };
    const retrievalService = {
      performRandomRetrievalForProvider: vi.fn(async () => []),
    };
    const walletSdkService = {
      getProviderInfo: vi.fn(() => undefined),
      loadProviders: vi.fn(async () => undefined),
    };
    storageProviderRepositoryMock.findOne.mockResolvedValue({
      providerId: undefined,
    });

    service = buildService({
      retrievalService: retrievalService as unknown as ConstructorParameters<typeof JobsService>[4],
      walletSdkService: walletSdkService as unknown as ConstructorParameters<typeof JobsService>[5],
    });

    await expect(
      callPrivate(service, "handleRetrievalJob", {
        id: "job-retrieval-missing-provider-id",
        data: {
          jobType: "retrieval",
          spAddress: "0xaaa",
          network: DEFAULT_NETWORK,
          intervalSeconds: 60,
        },
      }),
    ).rejects.toThrow("providerId is required for job execution");

    expect(retrievalService.performRandomRetrievalForProvider).not.toHaveBeenCalled();
    expect(completedCounter.inc).toHaveBeenCalledWith({
      job_type: "retrieval",
      handler_result: "error",
      network: DEFAULT_NETWORK,
    });
  });

  it("updates queue metrics from pg-boss state and age queries", async () => {
    const jobsQueuedGauge = metricsMocks.jobsQueuedGauge as unknown as { set: ReturnType<typeof vi.fn> };
    const jobsInFlightGauge = metricsMocks.jobsInFlightGauge as unknown as { set: ReturnType<typeof vi.fn> };
    const oldestQueuedGauge = metricsMocks.oldestQueuedAgeGauge as unknown as { set: ReturnType<typeof vi.fn> };
    const oldestInFlightGauge = metricsMocks.oldestInFlightAgeGauge as unknown as { set: ReturnType<typeof vi.fn> };
    const jobsPausedGauge = metricsMocks.jobsPausedGauge as unknown as { set: ReturnType<typeof vi.fn> };

    jobScheduleRepositoryMock.countBossJobStates.mockResolvedValueOnce([
      { job_type: "deal", state: "created", count: 2 },
      { job_type: "retrieval", state: "active", count: 1 },
      { job_type: "unknown", state: "created", count: 99 },
    ]);
    jobScheduleRepositoryMock.minBossJobAgeSecondsByState
      .mockResolvedValueOnce([{ job_type: "deal", min_age_seconds: 12 }])
      .mockResolvedValueOnce([{ job_type: "retrieval", min_age_seconds: 34 }]);

    await callPrivate(service, "updateQueueMetrics", DEFAULT_NETWORK);

    expect(jobsQueuedGauge.set).toHaveBeenCalledWith({ job_type: "deal", network: DEFAULT_NETWORK }, 0);
    expect(jobsQueuedGauge.set).toHaveBeenCalledWith({ job_type: "retrieval", network: DEFAULT_NETWORK }, 0);
    expect(jobsQueuedGauge.set).toHaveBeenCalledWith({ job_type: "data_retention_poll", network: DEFAULT_NETWORK }, 0);
    expect(jobsInFlightGauge.set).toHaveBeenCalledWith({ job_type: "retrieval", network: DEFAULT_NETWORK }, 1);
    expect(jobsQueuedGauge.set).toHaveBeenCalledWith({ job_type: "deal", network: DEFAULT_NETWORK }, 2);

    expect(oldestQueuedGauge.set).toHaveBeenCalledWith({ job_type: "deal", network: DEFAULT_NETWORK }, 12);
    expect(oldestInFlightGauge.set).toHaveBeenCalledWith({ job_type: "retrieval", network: DEFAULT_NETWORK }, 34);
    expect(jobsPausedGauge.set).toHaveBeenCalledWith({ job_type: "deal", network: DEFAULT_NETWORK }, 0);
  });

  it("registers pg-boss workers with per-queue batch sizes", async () => {
    const work = vi.fn().mockResolvedValue(undefined);
    (service as unknown as { boss: { work: typeof work } }).boss = { work };

    callPrivate(service, "registerWorkers");

    expect(work).toHaveBeenCalledWith(
      SP_WORK_QUEUE,
      { batchSize: 1, localConcurrency: 9, pollingIntervalSeconds: 60 },
      expect.any(Function),
    );
    expect(work).toHaveBeenCalledWith(
      DATA_RETENTION_POLL_QUEUE,
      { batchSize: 1, pollingIntervalSeconds: 60 },
      expect.any(Function),
    );
    expect(work).toHaveBeenCalledWith(
      PROVIDERS_REFRESH_QUEUE,
      { batchSize: 1, pollingIntervalSeconds: 60 },
      expect.any(Function),
    );
    expect(work).toHaveBeenCalledWith(
      PULL_PIECE_CLEANUP_QUEUE,
      { batchSize: 1, pollingIntervalSeconds: 60 },
      expect.any(Function),
    );
  });

  it("creates all worker queues when starting pg-boss", async () => {
    const createQueue = vi.fn().mockResolvedValue(undefined);

    await callPrivate(service, "ensureWorkerQueues", { createQueue });

    expect(createQueue).toHaveBeenCalledWith(SP_WORK_QUEUE, { policy: "singleton" });
    expect(createQueue).toHaveBeenCalledWith(PROVIDERS_REFRESH_QUEUE);
    expect(createQueue).toHaveBeenCalledWith(DATA_RETENTION_POLL_QUEUE);
    expect(createQueue).toHaveBeenCalledWith(PULL_PIECE_CLEANUP_QUEUE);
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

    await callPrivate(service, "updateQueueMetrics", DEFAULT_NETWORK);

    expect(jobsPausedGauge.set).toHaveBeenCalledWith({ job_type: "deal", network: DEFAULT_NETWORK }, 2);
  });

  it("adds schedule rows for newly seen providers", async () => {
    baseConfigValues = {
      ...baseConfigValues,
      networks: {
        calibration: { ...(baseConfigValues.networks as any).calibration, minNumDataSetsForChecks: 3 },
      } as unknown as IConfig["networks"],
    };
    configService = {
      get: vi.fn((key: keyof IConfig) => baseConfigValues[key]),
    } as unknown as JobsServiceDeps[0];

    service = buildService({ configService });

    const providerA = { address: "0xaaa" };
    const providerB = { address: "0xbbb" };

    storageProviderRepositoryMock.find.mockResolvedValueOnce([providerA]).mockResolvedValueOnce([providerA, providerB]);

    await callPrivate(service, "ensureScheduleRows", DEFAULT_NETWORK);
    await callPrivate(service, "ensureScheduleRows", DEFAULT_NETWORK);

    // Check upserts for providerB
    const upsertCalls = jobScheduleRepositoryMock.upsertSchedule.mock.calls;
    const upsertsForB = upsertCalls.filter((call) => call[1] === providerB.address);
    expect(upsertsForB).toHaveLength(5);
    expect(upsertsForB.map((call) => call[0]).sort()).toEqual([
      "data_set_creation",
      "deal",
      "piece_cleanup",
      "pull_check",
      "retrieval",
    ]);
  });

  it("deletes schedule rows for providers no longer present", async () => {
    const providerA = { address: "0xaaa" };
    storageProviderRepositoryMock.find.mockResolvedValueOnce([providerA]);

    await callPrivate(service, "ensureScheduleRows", DEFAULT_NETWORK);

    expect(jobScheduleRepositoryMock.deleteSchedulesForInactiveProviders).toHaveBeenCalledWith(
      [providerA.address],
      DEFAULT_NETWORK,
    );
  });

  it("does not delete schedule rows when no active providers exist", async () => {
    storageProviderRepositoryMock.find.mockResolvedValueOnce([]);

    await callPrivate(service, "ensureScheduleRows", DEFAULT_NETWORK);

    expect(jobScheduleRepositoryMock.deleteSchedulesForInactiveProviders).not.toHaveBeenCalled();
  });

  it("uses approved-only filter when configured", async () => {
    baseConfigValues = {
      ...baseConfigValues,
      networks: {
        calibration: { ...(baseConfigValues.networks as any).calibration, useOnlyApprovedProviders: true },
      } as unknown as IConfig["networks"],
    };
    configService = {
      get: vi.fn((key: keyof IConfig) => baseConfigValues[key]),
    } as unknown as JobsServiceDeps[0];

    service = buildService({ configService });

    storageProviderRepositoryMock.find.mockResolvedValueOnce([]);
    await callPrivate(service, "ensureScheduleRows", DEFAULT_NETWORK);

    expect(storageProviderRepositoryMock.find).toHaveBeenCalledWith({
      select: { address: true, providerId: true },
      where: { isActive: true, isApproved: true, network: DEFAULT_NETWORK },
    });
  });

  it("always inserts global data_retention_poll and providers_refresh schedules", async () => {
    storageProviderRepositoryMock.find.mockResolvedValueOnce([]);

    await callPrivate(service, "ensureScheduleRows", DEFAULT_NETWORK);

    expect(jobScheduleRepositoryMock.upsertSchedule).toHaveBeenCalledWith(
      "providers_refresh",
      "",
      DEFAULT_NETWORK,
      expect.any(Number),
      expect.any(Date),
    );
    expect(jobScheduleRepositoryMock.upsertSchedule).toHaveBeenCalledWith(
      "data_retention_poll",
      "",
      DEFAULT_NETWORK,
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
        network: DEFAULT_NETWORK,
        interval_seconds: 1,
        next_run_at: "2024-01-01T00:00:00Z",
      },
    ]);

    await callPrivate(service, "enqueueDueJobs", DEFAULT_NETWORK);

    expect(send).toHaveBeenCalledTimes(3);
    for (const call of send.mock.calls) {
      expect(call[0]).toBe("sp.work");
      expect(call[1]).toMatchObject({ jobType: "deal", spAddress: "0xaaa", network: DEFAULT_NETWORK });
      expect(call[2]).toMatchObject({ singletonKey: `${DEFAULT_NETWORK}:0xaaa`, retryLimit: 0 });
      expect(call[2]?.startAfter).toBeUndefined();
    }

    // Check update call
    expect(jobScheduleRepositoryMock.updateScheduleAfterRun).toHaveBeenCalled();
  });

  it("global jobs only enqueue once after downtime and skip to next future run", async () => {
    service = buildService({});

    const send = vi.fn();
    (service as unknown as { boss: { send: typeof send } }).boss = { send };

    const now = new Date("2024-01-01T04:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    // providers_refresh was due 8 intervals ago (4 hours / 30 min intervals = 8)
    jobScheduleRepositoryMock.findDueSchedulesWithManager.mockResolvedValueOnce([
      {
        id: 10,
        job_type: "providers_refresh",
        sp_address: "",
        network: DEFAULT_NETWORK,
        interval_seconds: 1800,
        next_run_at: "2024-01-01T00:00:00Z",
      },
    ]);

    await callPrivate(service, "enqueueDueJobs", DEFAULT_NETWORK);

    // Should only enqueue once despite being 8 intervals overdue
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe("providers.refresh");

    // next_run_at should jump to future (now + interval), not replay missed runs
    const updateCall = jobScheduleRepositoryMock.updateScheduleAfterRun.mock.calls[0];
    const newNextRunAt = updateCall[2] as Date;
    expect(newNextRunAt.getTime()).toBe(now.getTime() + 1800 * 1000);
  });

  it("global jobs get singletonKey set to job type", async () => {
    service = buildService({});

    const send = vi.fn();
    (service as unknown as { boss: { send: typeof send } }).boss = { send };

    const now = new Date("2024-01-01T00:01:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    jobScheduleRepositoryMock.findDueSchedulesWithManager.mockResolvedValueOnce([
      {
        id: 11,
        job_type: "providers_refresh",
        sp_address: "",
        network: DEFAULT_NETWORK,
        interval_seconds: 14400,
        next_run_at: "2024-01-01T00:00:00Z",
      },
    ]);

    await callPrivate(service, "enqueueDueJobs", DEFAULT_NETWORK);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][2]).toMatchObject({
      singletonKey: "calibration:providers_refresh",
      retryLimit: 0,
    });
  });

  it("global jobs are skipped during maintenance windows", async () => {
    baseConfigValues = {
      ...baseConfigValues,
      networks: {
        calibration: {
          ...baseConfigValues.networks?.calibration,
          maintenanceWindowsUtc: ["03:00"],
          maintenanceWindowMinutes: 60,
        } as INetworkConfig,
      } as INetworksConfig,
    };
    configService = {
      get: vi.fn((key: keyof IConfig) => baseConfigValues[key]),
    } as unknown as JobsServiceDeps[0];

    service = buildService({ configService });

    const send = vi.fn();
    (service as unknown as { boss: { send: typeof send } }).boss = { send };

    const now = new Date("2024-01-01T03:30:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    jobScheduleRepositoryMock.findDueSchedulesWithManager.mockResolvedValueOnce([
      {
        id: 20,
        job_type: "providers_refresh",
        network: DEFAULT_NETWORK,
        sp_address: "",
        interval_seconds: 1800,
        next_run_at: "2024-01-01T03:00:00Z",
      },
    ]);

    await callPrivate(service, "enqueueDueJobs", DEFAULT_NETWORK);

    // Global job should not be enqueued during maintenance
    expect(send).not.toHaveBeenCalled();

    expect(jobScheduleRepositoryMock.advanceScheduleNextRun).toHaveBeenCalled();
    const updateCall = jobScheduleRepositoryMock.advanceScheduleNextRun.mock.calls[0];
    const newNextRunAt = updateCall[2] as Date;
    expect(newNextRunAt.getTime()).toBe(now.getTime() + 1800 * 1000);
  });

  it("defers jobs until maintenance window ends (same-day)", async () => {
    baseConfigValues = {
      ...baseConfigValues,
      networks: {
        calibration: {
          ...baseConfigValues.networks?.calibration,
          maintenanceWindowsUtc: ["07:00"],
          maintenanceWindowMinutes: 20,
        } as INetworkConfig,
      } as INetworksConfig,
    };
    configService = {
      get: vi.fn((key: keyof IConfig) => baseConfigValues[key]),
    } as unknown as JobsServiceDeps[0];

    service = buildService({ configService });

    const safeSend = vi.fn().mockResolvedValue(true);
    (service as unknown as { safeSend: typeof safeSend }).safeSend = safeSend;

    const now = new Date("2024-01-01T07:05:00Z");
    const maintenance = callPrivate(service, "getMaintenanceWindowStatus", now, DEFAULT_NETWORK) as any;

    await callPrivate(
      service,
      "deferJobForMaintenance",
      "deal",
      { jobType: "deal", spAddress: "0xaaa", network: DEFAULT_NETWORK, intervalSeconds: 60 },
      maintenance,
      now,
    );

    const expectedResumeAt = new Date("2024-01-01T07:20:00Z");
    expect(safeSend).toHaveBeenCalledWith(
      "deal",
      "sp.work",
      { jobType: "deal", spAddress: "0xaaa", network: DEFAULT_NETWORK, intervalSeconds: 60 },
      { startAfter: expectedResumeAt },
    );
  });

  it("defers jobs until maintenance window ends (wraps midnight)", async () => {
    baseConfigValues = {
      ...baseConfigValues,
      networks: {
        calibration: {
          ...baseConfigValues.networks?.calibration,
          maintenanceWindowsUtc: ["23:50"],
          maintenanceWindowMinutes: 20,
        } as INetworkConfig,
      } as INetworksConfig,
    };
    configService = {
      get: vi.fn((key: keyof IConfig) => baseConfigValues[key]),
    } as unknown as JobsServiceDeps[0];

    service = buildService({ configService });

    const safeSend = vi.fn().mockResolvedValue(true);
    (service as unknown as { safeSend: typeof safeSend }).safeSend = safeSend;

    const now = new Date("2024-01-01T23:55:00Z");
    const maintenance = callPrivate(service, "getMaintenanceWindowStatus", now, DEFAULT_NETWORK) as any;

    await callPrivate(
      service,
      "deferJobForMaintenance",
      "retrieval",
      { jobType: "retrieval", spAddress: "0xbbb", network: DEFAULT_NETWORK, intervalSeconds: 60 },
      maintenance,
      now,
    );

    const expectedResumeAt = new Date("2024-01-02T00:10:00Z");
    expect(safeSend).toHaveBeenCalledWith(
      "retrieval",
      "sp.work",
      { jobType: "retrieval", spAddress: "0xbbb", network: DEFAULT_NETWORK, intervalSeconds: 60 },
      { startAfter: expectedResumeAt },
    );
  });

  it("deal job delegates to createDealForProvider", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00Z"));
    const dealService = {
      createDealForProvider: vi.fn(async () => ({})),
    };

    const walletSdkService = {
      getTestingProviders: vi.fn(() => [{ serviceProvider: "0xaaa" }]),
      ensureWalletAllowances: vi.fn(),
      loadProviders: vi.fn(),
      getProviderInfo: vi.fn(() => ({ id: 1, name: "test-provider" })),
    };

    service = buildService({
      dealService: dealService as unknown as ConstructorParameters<typeof JobsService>[3],
      walletSdkService: walletSdkService as unknown as ConstructorParameters<typeof JobsService>[5],
    });

    await callPrivate(service, "handleDealJob", {
      id: "job-deal-1",
      data: { jobType: "deal", spAddress: "0xaaa", network: DEFAULT_NETWORK, intervalSeconds: 60 },
    });

    expect(dealService.createDealForProvider).toHaveBeenCalledTimes(1);
    expect(dealService.createDealForProvider).toHaveBeenCalledWith(
      expect.objectContaining({ serviceProvider: "0xaaa" }),
      expect.objectContaining({
        logContext: expect.objectContaining({ providerAddress: "0xaaa", providerId: 1 }),
      }),
    );
  });

  it("deal job does not consult piece cleanup quota before creating deals", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00Z"));
    const dealService = {
      createDealForProvider: vi.fn(async () => ({})),
    };

    const walletSdkService = {
      getTestingProviders: vi.fn(() => [{ serviceProvider: "0xaaa" }]),
      ensureWalletAllowances: vi.fn(),
      loadProviders: vi.fn(),
      getProviderInfo: vi.fn(() => ({ id: 1, name: "test-provider" })),
    };

    const pieceCleanupService = {
      cleanupPiecesForProvider: vi.fn(() => {
        throw new Error("deal job must not run cleanup");
      }),
    };

    service = buildService({
      dealService: dealService as unknown as ConstructorParameters<typeof JobsService>[3],
      walletSdkService: walletSdkService as unknown as ConstructorParameters<typeof JobsService>[5],
      pieceCleanupService: pieceCleanupService as unknown as JobsServiceDeps[7],
    });

    await callPrivate(service, "handleDealJob", {
      id: "job-deal-no-quota-gate",
      data: { jobType: "deal", spAddress: "0xaaa", network: DEFAULT_NETWORK, intervalSeconds: 60 },
    });

    expect(pieceCleanupService.cleanupPiecesForProvider).not.toHaveBeenCalled();
    expect(dealService.createDealForProvider).toHaveBeenCalledTimes(1);
  });

  it("deal job maps DealJobTerminatedDataSetError to handler_result=error", async () => {
    const completedCounter = metricsMocks.jobsCompletedCounter as unknown as { inc: ReturnType<typeof vi.fn> };
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00Z"));

    const dealService = {
      createDealForProvider: vi.fn(async () => {
        throw new DealJobTerminatedDataSetError(42n);
      }),
    };

    const walletSdkService = {
      getTestingProviders: vi.fn(() => [{ serviceProvider: "0xaaa" }]),
      ensureWalletAllowances: vi.fn(),
      loadProviders: vi.fn(),
      getProviderInfo: vi.fn(() => ({ id: 1, name: "test-provider" })),
    };

    service = buildService({
      dealService: dealService as unknown as ConstructorParameters<typeof JobsService>[3],
      walletSdkService: walletSdkService as unknown as ConstructorParameters<typeof JobsService>[5],
    });

    await callPrivate(service, "handleDealJob", {
      id: "job-deal-terminated",
      data: { jobType: "deal", spAddress: "0xaaa", network: DEFAULT_NETWORK, intervalSeconds: 60 },
    });

    expect(dealService.createDealForProvider).toHaveBeenCalledTimes(1);
    expect(completedCounter.inc).toHaveBeenCalledWith({
      job_type: "deal",
      handler_result: "error",
      network: DEFAULT_NETWORK,
    });
  });

  it("data_set_creation job creates initial data set when minNumDataSetsForChecks is 1", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00Z"));

    const dealService = {
      getBaseDataSetMetadata: vi.fn(() => ({ withIpniIndexing: "" })),
      getDataSetProvisioningStatus: vi.fn(async () => ({ status: "missing" as const })),
      createDataSetWithPiece: vi.fn(async () => {}),
      repairTerminatedDataSet: vi.fn(),
    };

    const walletSdkService = {
      getProviderInfo: vi.fn(() => ({ id: 1, name: "test-provider" })),
    };

    service = buildService({
      dealService: dealService as unknown as ConstructorParameters<typeof JobsService>[3],
      walletSdkService: walletSdkService as unknown as ConstructorParameters<typeof JobsService>[5],
    });

    await callPrivate(service, "handleDataSetCreationJob", {
      id: "job-ds-1",
      data: { jobType: "data_set_creation", spAddress: "0xaaa", network: DEFAULT_NETWORK, intervalSeconds: 3600 },
    });

    expect(dealService.createDataSetWithPiece).toHaveBeenCalledTimes(1);
    expect(dealService.createDataSetWithPiece).toHaveBeenCalledWith(
      "0xaaa",
      { withIpniIndexing: "" },
      DEFAULT_NETWORK,
      expect.any(AbortSignal),
    );
  });

  it("data_set_creation job skips when all data sets already exist", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00Z"));

    baseConfigValues = {
      ...baseConfigValues,
      networks: {
        calibration: { ...(baseConfigValues.networks as any).calibration, minNumDataSetsForChecks: 3 },
      } as unknown as IConfig["networks"],
    };
    configService = {
      get: vi.fn((key: keyof IConfig) => baseConfigValues[key]),
    } as unknown as JobsServiceDeps[0];

    const dealService = {
      getBaseDataSetMetadata: vi.fn(() => ({ dealbotDataSetVersion: "v1" })),
      getDataSetProvisioningStatus: vi.fn(async () => ({ status: "live" as const, dataSetId: 42n })),
      createDataSetWithPiece: vi.fn(async () => {}),
      repairTerminatedDataSet: vi.fn(),
    };

    const walletSdkService = {
      getProviderInfo: vi.fn(() => ({ id: 1, name: "test-provider" })),
    };

    service = buildService({
      configService,
      dealService: dealService as unknown as ConstructorParameters<typeof JobsService>[3],
      walletSdkService: walletSdkService as unknown as ConstructorParameters<typeof JobsService>[5],
    });

    await callPrivate(service, "handleDataSetCreationJob", {
      id: "job-ds-2",
      data: { jobType: "data_set_creation", spAddress: "0xaaa", network: DEFAULT_NETWORK, intervalSeconds: 3600 },
    });

    expect(dealService.createDataSetWithPiece).not.toHaveBeenCalled();
    expect(dealService.getDataSetProvisioningStatus).toHaveBeenCalledWith(
      "0xaaa",
      { dealbotDataSetVersion: "v1" },
      DEFAULT_NETWORK,
      expect.any(AbortSignal),
    );
  });

  it("data_set_creation job creates only the first missing data set", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00Z"));
    baseConfigValues = {
      ...baseConfigValues,
      networks: {
        calibration: { ...(baseConfigValues.networks as any).calibration, minNumDataSetsForChecks: 3 },
      } as unknown as IConfig["networks"],
    };
    configService = {
      get: vi.fn((key: keyof IConfig) => baseConfigValues[key]),
    } as unknown as JobsServiceDeps[0];

    const dealService = {
      getBaseDataSetMetadata: vi.fn(() => ({ dealbotDataSetVersion: "v1" })),
      getDataSetProvisioningStatus: vi.fn(async () => ({ status: "missing" as const })),
      createDataSetWithPiece: vi.fn(async () => {}),
      repairTerminatedDataSet: vi.fn(),
    };

    const walletSdkService = {
      getProviderInfo: vi.fn(() => ({ id: 1, name: "test-provider" })),
    };

    service = buildService({
      configService,
      dealService: dealService as unknown as ConstructorParameters<typeof JobsService>[3],
      walletSdkService: walletSdkService as unknown as ConstructorParameters<typeof JobsService>[5],
    });

    await callPrivate(service, "handleDataSetCreationJob", {
      id: "job-ds-3",
      data: { jobType: "data_set_creation", spAddress: "0xaaa", network: DEFAULT_NETWORK, intervalSeconds: 3600 },
    });

    // Only the first missing data set (index 0) should be created
    expect(dealService.createDataSetWithPiece).toHaveBeenCalledTimes(1);
    expect(dealService.createDataSetWithPiece).toHaveBeenCalledWith(
      "0xaaa",
      { dealbotDataSetVersion: "v1" },
      DEFAULT_NETWORK,
      expect.any(AbortSignal),
    );
  });

  it("data_set_creation job skips existing and creates next missing data set", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00Z"));
    baseConfigValues = {
      ...baseConfigValues,
      networks: {
        calibration: { ...(baseConfigValues.networks as any).calibration, minNumDataSetsForChecks: 3 },
      } as unknown as IConfig["networks"],
    };
    configService = {
      get: vi.fn((key: keyof IConfig) => baseConfigValues[key]),
    } as unknown as JobsServiceDeps[0];

    const dealService = {
      getBaseDataSetMetadata: vi.fn(() => ({ dealbotDataSetVersion: "v1" })),
      // Index 0 exists, index 1 does not
      getDataSetProvisioningStatus: vi.fn(async (_sp: string, metadata: Record<string, string>) =>
        metadata.dealbotDS ? { status: "missing" as const } : { status: "live" as const, dataSetId: 1n },
      ),
      createDataSetWithPiece: vi.fn(async () => {}),
      repairTerminatedDataSet: vi.fn(),
    };

    const walletSdkService = {
      getProviderInfo: vi.fn(() => ({ id: 1, name: "test-provider" })),
    };

    service = buildService({
      configService,
      dealService: dealService as unknown as ConstructorParameters<typeof JobsService>[3],
      walletSdkService: walletSdkService as unknown as ConstructorParameters<typeof JobsService>[5],
    });

    await callPrivate(service, "handleDataSetCreationJob", {
      id: "job-ds-3b",
      data: { jobType: "data_set_creation", spAddress: "0xaaa", network: DEFAULT_NETWORK, intervalSeconds: 3600 },
    });

    // Should skip index 0 (exists) and create only index 1
    expect(dealService.createDataSetWithPiece).toHaveBeenCalledTimes(1);
    expect(dealService.createDataSetWithPiece).toHaveBeenCalledWith(
      "0xaaa",
      { dealbotDataSetVersion: "v1", dealbotDS: "1" },
      DEFAULT_NETWORK,
      expect.any(AbortSignal),
    );
  });

  it("data_set_creation job stops provisioning when abort signal fires", async () => {
    const dealService = {
      getDataSetProvisioningStatus: vi.fn(async () => ({ status: "missing" as const })),
      createDataSetWithPiece: vi.fn(async () => {}),
      repairTerminatedDataSet: vi.fn(),
    };

    const logger = { log: vi.fn() } as any;

    // Pre-abort the signal so throwIfAborted fires on first check
    const controller = new AbortController();
    controller.abort(new Error("Job timed out"));

    const { provisionNextMissingDataSet } = await import("./data-set-creation.handler.js");

    await expect(
      provisionNextMissingDataSet(
        { dealService, logger },
        "0xaaa",
        DEFAULT_NETWORK,
        5,
        {},
        {
          providerAddress: "0xaaa",
          jobId: "job-ds-4",
          providerId: 1n,
          providerName: "test-provider",
          network: DEFAULT_NETWORK,
        },
        controller.signal,
      ),
    ).rejects.toThrow("Job timed out");

    // No datasets should have been created since abort was already signaled
    expect(dealService.createDataSetWithPiece).not.toHaveBeenCalled();
  });

  it("data_set_creation handler runs repair on terminated dataset and skips provisioning this tick", async () => {
    const dealService = {
      getDataSetProvisioningStatus: vi.fn(async () => ({
        status: "terminated" as const,
        dataSetId: 7n,
      })),
      createDataSetWithPiece: vi.fn(async () => {}),
      repairTerminatedDataSet: vi.fn(async () => ({ dealsAffected: 3, pdpEndEpoch: 1n })),
    };
    const logger = { log: vi.fn(), warn: vi.fn() } as any;
    const { provisionNextMissingDataSet } = await import("./data-set-creation.handler.js");

    await provisionNextMissingDataSet(
      { dealService, logger },
      "0xaaa",
      DEFAULT_NETWORK,
      3,
      {},
      { providerAddress: "0xaaa", jobId: "job-ds-term", providerId: 1n, providerName: "sp", network: DEFAULT_NETWORK },
    );

    expect(dealService.repairTerminatedDataSet).toHaveBeenCalledWith("0xaaa", 7n, DEFAULT_NETWORK, undefined);
    expect(dealService.createDataSetWithPiece).not.toHaveBeenCalled();
  });

  it("sets active, inactive, and tested provider gauge values after refresh", async () => {
    storageProviderRepositoryMock.count
      .mockResolvedValueOnce(10) // totalProviders
      .mockResolvedValueOnce(7) // activeCount
      .mockResolvedValueOnce(7); // testedCount (useOnlyApprovedProviders=false, no global blocklist)

    const activeGauge = metricsMocks.storageProvidersActive as unknown as { set: ReturnType<typeof vi.fn> };
    const testedGauge = metricsMocks.storageProvidersTested as unknown as { set: ReturnType<typeof vi.fn> };

    await callPrivate(service, "updateStorageProviderGauges", DEFAULT_NETWORK);

    expect(activeGauge.set).toHaveBeenCalledWith({ status: "active", network: DEFAULT_NETWORK }, 7);
    expect(activeGauge.set).toHaveBeenCalledWith({ status: "inactive", network: DEFAULT_NETWORK }, 3);
    expect(testedGauge.set).toHaveBeenCalledWith({ network: DEFAULT_NETWORK }, 7);
  });

  it("filters tested providers by isApproved when useOnlyApprovedProviders is enabled", async () => {
    baseConfigValues = {
      ...baseConfigValues,
      networks: {
        calibration: { ...(baseConfigValues.networks as any).calibration, useOnlyApprovedProviders: true },
      } as unknown as IConfig["networks"],
    };
    service = buildService();

    storageProviderRepositoryMock.count.mockResolvedValueOnce(10).mockResolvedValueOnce(7).mockResolvedValueOnce(5); // testedCount (only approved)

    await callPrivate(service, "updateStorageProviderGauges", DEFAULT_NETWORK);

    expect(storageProviderRepositoryMock.count).toHaveBeenNthCalledWith(3, {
      where: { isActive: true, isApproved: true, network: DEFAULT_NETWORK },
    });
  });

  it("subtracts globally blocked providers from tested gauge when global blocklist is non-empty", async () => {
    baseConfigValues = {
      ...baseConfigValues,
      networks: {
        calibration: {
          ...(baseConfigValues.networks as any).calibration,
          blockedSpIds: new Set<string>(),
          blockedSpAddresses: new Set(["0xblocked"]),
        },
      } as unknown as IConfig["networks"],
    };
    configService = {
      get: vi.fn((key: keyof IConfig) => baseConfigValues[key]),
    } as unknown as JobsServiceDeps[0];

    service = buildService({ configService });

    storageProviderRepositoryMock.count
      .mockResolvedValueOnce(3) // totalProviders
      .mockResolvedValueOnce(3); // activeCount
    // find() for tested providers when global blocklist is non-empty
    storageProviderRepositoryMock.find.mockResolvedValueOnce([
      { address: "0xactive" },
      { address: "0xblocked" },
      { address: "0xother" },
    ]);

    const testedGauge = metricsMocks.storageProvidersTested as unknown as { set: ReturnType<typeof vi.fn> };

    await callPrivate(service, "updateStorageProviderGauges", DEFAULT_NETWORK);

    expect(testedGauge.set).toHaveBeenCalledWith({ network: DEFAULT_NETWORK }, 2); // 3 providers minus 1 globally blocked
  });

  it("catches storage provider gauge errors without rethrowing", async () => {
    storageProviderRepositoryMock.count.mockRejectedValueOnce(new Error("db error"));
    await expect(callPrivate(service, "updateStorageProviderGauges")).resolves.toBeUndefined();
  });

  it("skips schedule upsert for blocked provider and excludes it from cleanup active-list", async () => {
    const providerA = { address: "0xaaa", providerId: 1n };
    storageProviderRepositoryMock.find.mockResolvedValueOnce([providerA]);

    baseConfigValues = {
      ...baseConfigValues,
      networks: {
        calibration: {
          ...(baseConfigValues.networks as any).calibration,
          blockedSpIds: new Set(["1"]),
          blockedSpAddresses: new Set(),
        },
      } as unknown as IConfig["networks"],
    };
    service = buildService();

    await callPrivate(service, "ensureScheduleRows", DEFAULT_NETWORK);

    const upsertCalls = jobScheduleRepositoryMock.upsertSchedule.mock.calls;
    const jobTypes = upsertCalls.filter((c) => c[1] === providerA.address).map((c) => c[0]);
    expect(jobTypes).not.toContain("deal");
    expect(jobTypes).not.toContain("data_set_creation");
    expect(jobTypes).not.toContain("retrieval");
    // Blocked provider is excluded from the active-address list passed to cleanup,
    // so its existing schedule rows will be deleted.
    expect(jobScheduleRepositoryMock.deleteSchedulesForInactiveProviders).toHaveBeenCalledWith([], DEFAULT_NETWORK);
  });

  it("deal job is skipped at runtime when provider is blocked", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00Z"));

    baseConfigValues = {
      ...baseConfigValues,
      networks: {
        calibration: {
          ...(baseConfigValues.networks as any).calibration,
          blockedSpIds: new Set(["1"]),
          blockedSpAddresses: new Set(),
        },
      } as unknown as IConfig["networks"],
    };

    const dealService = {
      createDealForProvider: vi.fn(),
      getBaseDataSetMetadata: vi.fn(() => ({})),
    };
    const walletSdkService = {
      getTestingProviders: vi.fn(() => [{ serviceProvider: "0xaaa", id: 1n }]),
      loadProviders: vi.fn(),
      getProviderInfo: vi.fn(() => ({ id: 1n, name: "sp" })),
    };

    service = buildService({
      dealService: dealService as unknown as JobsServiceDeps[3],
      walletSdkService: walletSdkService as unknown as JobsServiceDeps[5],
    });

    await callPrivate(service, "handleDealJob", {
      id: "job-blocked-deal",
      data: { jobType: "deal", spAddress: "0xaaa", network: DEFAULT_NETWORK, intervalSeconds: 60 },
    });

    expect(dealService.createDealForProvider).not.toHaveBeenCalled();
  });

  it("retrieval job is skipped at runtime when provider is blocked", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00Z"));

    baseConfigValues = {
      ...baseConfigValues,
      networks: {
        calibration: {
          ...(baseConfigValues.networks as any).calibration,
          blockedSpIds: new Set(["2"]),
          blockedSpAddresses: new Set(),
        },
      } as unknown as IConfig["networks"],
    };

    const retrievalService = { performRandomRetrievalForProvider: vi.fn() };
    const walletSdkService = {
      getProviderInfo: vi.fn(() => ({ id: 2n, name: "sp" })),
    };

    service = buildService({
      retrievalService: retrievalService as unknown as JobsServiceDeps[4],
      walletSdkService: walletSdkService as unknown as JobsServiceDeps[5],
    });

    await callPrivate(service, "handleRetrievalJob", {
      id: "job-blocked-retrieval",
      data: { jobType: "retrieval", spAddress: "0xaaa", network: DEFAULT_NETWORK, intervalSeconds: 60 },
    });

    expect(retrievalService.performRandomRetrievalForProvider).not.toHaveBeenCalled();
  });

  it("data_set_creation job is skipped at runtime when provider is blocked", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00Z"));

    baseConfigValues = {
      ...baseConfigValues,
      networks: {
        calibration: {
          ...(baseConfigValues.networks as any).calibration,
          blockedSpIds: new Set(["3"]),
          blockedSpAddresses: new Set(),
        },
      } as unknown as IConfig["networks"],
    };

    const dealService = {
      getBaseDataSetMetadata: vi.fn(() => ({})),
      getDataSetProvisioningStatus: vi.fn(async () => ({ status: "missing" as const })),
      createDataSetWithPiece: vi.fn(async () => {}),
      repairTerminatedDataSet: vi.fn(),
    };
    const walletSdkService = {
      getProviderInfo: vi.fn(() => ({ id: 3n, name: "sp" })),
    };

    service = buildService({
      dealService: dealService as unknown as JobsServiceDeps[3],
      walletSdkService: walletSdkService as unknown as JobsServiceDeps[5],
    });

    await callPrivate(service, "handleDataSetCreationJob", {
      id: "job-blocked-ds",
      data: { jobType: "data_set_creation", spAddress: "0xaaa", network: DEFAULT_NETWORK, intervalSeconds: 3600 },
    });

    expect(dealService.createDataSetWithPiece).not.toHaveBeenCalled();
  });

  it("SP jobs skip address-blocked providers before resolving missing provider context", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00Z"));

    baseConfigValues = {
      ...baseConfigValues,
      networks: {
        calibration: {
          ...(baseConfigValues.networks as any).calibration,
          blockedSpIds: new Set(),
          blockedSpAddresses: new Set(["0xaaa"]),
        },
      } as unknown as IConfig["networks"],
    };

    const completedCounter = metricsMocks.jobsCompletedCounter as unknown as { inc: ReturnType<typeof vi.fn> };
    const dealService = {
      createDealForProvider: vi.fn(),
      getBaseDataSetMetadata: vi.fn(() => ({})),
    };
    const retrievalService = { performRandomRetrievalForProvider: vi.fn() };
    const dataSetDealService = {
      getBaseDataSetMetadata: vi.fn(() => ({})),
      getDataSetProvisioningStatus: vi.fn(async () => ({ status: "missing" as const })),
      createDataSetWithPiece: vi.fn(async () => {}),
      repairTerminatedDataSet: vi.fn(),
    };
    const walletSdkService = {
      getTestingProviders: vi.fn(() => []),
      getProviderInfo: vi.fn(() => undefined),
      loadProviders: vi.fn(),
    };

    const cases = [
      {
        handler: "handleDealJob",
        jobType: "deal",
        intervalSeconds: 60,
        service: buildService({
          dealService: dealService as unknown as JobsServiceDeps[3],
          walletSdkService: walletSdkService as unknown as JobsServiceDeps[5],
        }),
        expectCheckNotRun: () => expect(dealService.createDealForProvider).not.toHaveBeenCalled(),
      },
      {
        handler: "handleRetrievalJob",
        jobType: "retrieval",
        intervalSeconds: 60,
        service: buildService({
          retrievalService: retrievalService as unknown as JobsServiceDeps[4],
          walletSdkService: walletSdkService as unknown as JobsServiceDeps[5],
        }),
        expectCheckNotRun: () => expect(retrievalService.performRandomRetrievalForProvider).not.toHaveBeenCalled(),
      },
      {
        handler: "handleDataSetCreationJob",
        jobType: "data_set_creation",
        intervalSeconds: 3600,
        service: buildService({
          dealService: dataSetDealService as unknown as JobsServiceDeps[3],
          walletSdkService: walletSdkService as unknown as JobsServiceDeps[5],
        }),
        expectCheckNotRun: () => expect(dataSetDealService.createDataSetWithPiece).not.toHaveBeenCalled(),
      },
    ];

    for (const testCase of cases) {
      await callPrivate(testCase.service, testCase.handler, {
        id: `job-address-blocked-${testCase.jobType}`,
        data: {
          jobType: testCase.jobType,
          spAddress: "0xaaa",
          network: DEFAULT_NETWORK,
          intervalSeconds: testCase.intervalSeconds,
        },
      });

      testCase.expectCheckNotRun();
      expect(completedCounter.inc).toHaveBeenCalledWith({
        job_type: testCase.jobType,
        handler_result: "success",
        network: DEFAULT_NETWORK,
      });
    }

    expect(storageProviderRepositoryMock.findOne).not.toHaveBeenCalled();
  });

  describe("onApplicationShutdown drain", () => {
    type BossMock = {
      stop: ReturnType<typeof vi.fn>;
      off: ReturnType<typeof vi.fn>;
    };

    const attachMockBoss = (): BossMock => {
      const bossMock: BossMock = {
        stop: vi.fn(async () => undefined),
        off: vi.fn(),
      };
      (service as unknown as { boss: BossMock | null }).boss = bossMock;
      return bossMock;
    };

    it("calls boss.stop with explicit graceful timeout derived from the longest job timeout", async () => {
      vi.useFakeTimers();
      const bossMock = attachMockBoss();

      const shutdownPromise = service.onApplicationShutdown();
      await vi.advanceTimersByTimeAsync(35_001);
      await shutdownPromise;

      // Defaults: deal=360, retrieval=60, dataSetCreation=300, pullCheck=300 → max=360 → +60s buffer
      expect(bossMock.stop).toHaveBeenCalledTimes(1);
      expect(bossMock.stop).toHaveBeenCalledWith({ graceful: true, timeout: 420_000 });
    });

    it("picks the longest timeout across all job types, including pullCheck under pullPiece", async () => {
      vi.useFakeTimers();
      baseConfigValues = {
        ...baseConfigValues,
        networks: {
          calibration: {
            ...(baseConfigValues.networks as any).calibration,
            dealJobTimeoutSeconds: 120,
            retrievalJobTimeoutSeconds: 60,
            dataSetCreationJobTimeoutSeconds: 120,
            pullCheckJobTimeoutSeconds: 600,
          },
        } as unknown as IConfig["networks"],
      };
      configService = {
        get: vi.fn((key: keyof IConfig) => baseConfigValues[key]),
      } as unknown as JobsServiceDeps[0];
      service = buildService({ configService });
      const bossMock = attachMockBoss();

      const shutdownPromise = service.onApplicationShutdown();
      await vi.advanceTimersByTimeAsync(35_001);
      await shutdownPromise;

      // pullCheck wins at 600s, plus 60s buffer
      expect(bossMock.stop).toHaveBeenCalledWith({ graceful: true, timeout: 660_000 });
    });

    it("holds the process for SHUTDOWN_FINAL_SCRAPE_DELAY_SECONDS after drain", async () => {
      vi.useFakeTimers();
      const bossMock = attachMockBoss();

      const shutdownPromise = service.onApplicationShutdown();

      // boss.stop is awaited before the sleep, so let it resolve first.
      await Promise.resolve();
      await Promise.resolve();
      expect(bossMock.stop).toHaveBeenCalledTimes(1);

      // Now the sleep is pending. Advance just under the configured delay (35_000ms).
      await vi.advanceTimersByTimeAsync(34_999);
      // Race the promise against a microtask to confirm it hasn't resolved yet.
      const settled = await Promise.race([shutdownPromise.then(() => "done"), Promise.resolve("pending")]);
      expect(settled).toBe("pending");

      await vi.advanceTimersByTimeAsync(2);
      await shutdownPromise;
    });

    it("skips the post-drain sleep when shutdownFinalScrapeDelaySeconds is 0", async () => {
      vi.useFakeTimers();
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      baseConfigValues = {
        ...baseConfigValues,
        jobs: {
          ...baseConfigValues.jobs,
          shutdownFinalScrapeDelaySeconds: 0,
        } as IConfig["jobs"],
      };
      configService = {
        get: vi.fn((key: keyof IConfig) => baseConfigValues[key]),
      } as unknown as JobsServiceDeps[0];
      service = buildService({ configService });
      const setTimeoutCallsBefore = setTimeoutSpy.mock.calls.length;
      attachMockBoss();

      await service.onApplicationShutdown();

      // No additional setTimeout calls from the post-drain hold.
      expect(setTimeoutSpy.mock.calls.length).toBe(setTimeoutCallsBefore);
    });
  });
});
