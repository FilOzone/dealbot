import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClickhouseService } from "../clickhouse/clickhouse.service.js";
import { Deal } from "../database/entities/deal.entity.js";
import { Retrieval } from "../database/entities/retrieval.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { RetrievalStatus } from "../database/types.js";
import { DatasetLivenessService } from "../dataset-liveness/dataset-liveness.service.js";
import { IpniVerificationService } from "../ipni/ipni-verification.service.js";
import { DiscoverabilityCheckMetrics, RetrievalCheckMetrics } from "../metrics-prometheus/check-metrics.service.js";
import { RetrievalAddonsService } from "../retrieval-addons/retrieval-addons.service.js";
import { RetrievalService } from "./retrieval.service.js";

describe("RetrievalService timeouts", () => {
  // Mapped type strips private members so the intersection doesn't collapse to `never`.
  type PublicInterface<T> = { [K in keyof T]: T[K] };
  type RetrievalServicePrivate = PublicInterface<RetrievalService> & {
    processRetrievalsInParallel: (
      deals: Deal[],
      options: { maxConcurrency?: number; signal?: AbortSignal },
    ) => Promise<Retrieval[][]>;
    performAllRetrievals: (deal: Deal, signal?: AbortSignal) => Promise<Retrieval[]>;
  };

  let service: RetrievalServicePrivate;

  const mockRetrievalAddonsService = {
    testAllRetrievalMethods: vi.fn(),
    getApplicableStrategies: vi.fn().mockReturnValue([{}]),
  };
  const mockConfigService = {
    get: vi.fn((key: string) => {
      if (key === "app") return { runMode: "api" };
      if (key === "jobs") return { pgbossSchedulerEnabled: false };
      if (key === "blockchain") return { network: "calibration" };
      if (key === "dataset") return { randomDatasetSizes: [10] };
      if (key === "timeouts") return { ipniVerificationTimeoutMs: 10_000, ipniVerificationPollingMs: 2_000 };
      return undefined;
    }),
  };
  const mockIpniVerificationService = {
    verify: vi.fn(),
  };
  const mockDiscoverabilityMetrics = {
    recordStatus: vi.fn(),
    observeIpniVerifyMs: vi.fn(),
  };

  const mockDealRepository = {
    find: vi.fn(),
  };

  const mockRetrievalRepository = {
    create: vi.fn(),
    save: vi.fn(),
  };

  const mockSpRepository = {
    findOne: vi.fn(),
  };
  const mockRetrievalMetrics = {
    observeFirstByteMs: vi.fn(),
    observeLastByteMs: vi.fn(),
    observeThroughput: vi.fn(),
    observeCheckDuration: vi.fn(),
    recordStatus: vi.fn(),
    recordHttpResponseCode: vi.fn(),
    recordResultMetrics: vi.fn(),
  };

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const buildDeal = (overrides: Partial<Deal> = {}): Deal =>
    ({
      id: "deal-1",
      spAddress: "0xsp",
      walletAddress: "0xwallet",
      pieceCid: "bafy-piece",
      dataSetId: "13006",
      pieceId: 42,
      ...overrides,
    }) as Deal;

  const createService = async (): Promise<RetrievalServicePrivate> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetrievalService,
        { provide: RetrievalAddonsService, useValue: mockRetrievalAddonsService },
        { provide: getRepositoryToken(Deal), useValue: mockDealRepository },
        { provide: getRepositoryToken(Retrieval), useValue: mockRetrievalRepository },
        { provide: getRepositoryToken(StorageProvider), useValue: mockSpRepository },
        { provide: RetrievalCheckMetrics, useValue: mockRetrievalMetrics },
        { provide: DiscoverabilityCheckMetrics, useValue: mockDiscoverabilityMetrics },
        { provide: IpniVerificationService, useValue: mockIpniVerificationService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ClickhouseService, useValue: { insert: vi.fn(), probeLocation: "test" } },
        {
          provide: DatasetLivenessService,
          useValue: {
            isDataSetLive: vi.fn().mockResolvedValue(true),
            isPieceLive: vi.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();

    return module.get<RetrievalService>(RetrievalService) as unknown as RetrievalServicePrivate;
  };

  it("records a failed retrieval when an execution result fails", async () => {
    service = await createService();

    const timeoutError = "HTTP request timed out after 50ms";
    mockSpRepository.findOne.mockResolvedValue({ address: "0xsp", name: "Test SP" });
    mockRetrievalRepository.create.mockImplementation(
      (data: Parameters<typeof mockRetrievalRepository.create>[0]) =>
        data as ReturnType<typeof mockRetrievalRepository.create>,
    );
    mockRetrievalRepository.save.mockImplementation(
      async (data: Parameters<typeof mockRetrievalRepository.save>[0]) =>
        data as ReturnType<typeof mockRetrievalRepository.save>,
    );
    mockRetrievalAddonsService.testAllRetrievalMethods.mockResolvedValue({
      dealId: "deal-1",
      results: [
        {
          url: "http://example.com",
          method: "direct",
          data: Buffer.alloc(0),
          metrics: {
            latency: 0,
            ttfb: 0,
            throughput: 0,
            statusCode: 0,
            timestamp: new Date(),
            responseSize: 0,
          },
          success: false,
          error: timeoutError,
          retryCount: 0,
        },
      ],
      summary: {
        totalMethods: 1,
        successfulMethods: 0,
        failedMethods: 1,
        fastestMethod: undefined,
        fastestLatency: undefined,
      },
      testedAt: new Date(),
    });

    await service.performAllRetrievals(buildDeal());

    expect(mockRetrievalRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: RetrievalStatus.FAILED,
        errorMessage: timeoutError,
      }),
    );
  });

  it("emits retrieval timing and status metrics", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    try {
      service = await createService();

      mockSpRepository.findOne.mockResolvedValue({
        address: "0xsp",
        providerId: 7,
        isApproved: false,
        name: "Test SP",
      });
      mockRetrievalRepository.create.mockImplementation(
        (data: Parameters<typeof mockRetrievalRepository.create>[0]) =>
          data as ReturnType<typeof mockRetrievalRepository.create>,
      );
      mockRetrievalRepository.save.mockImplementation(
        async (data: Parameters<typeof mockRetrievalRepository.save>[0]) =>
          data as ReturnType<typeof mockRetrievalRepository.save>,
      );

      mockRetrievalAddonsService.testAllRetrievalMethods.mockImplementation(async () => {
        vi.advanceTimersByTime(2500);
        return {
          dealId: "deal-1",
          results: [
            {
              url: "http://example.com",
              method: "direct",
              data: Buffer.alloc(0),
              metrics: {
                latency: 400,
                ttfb: 100,
                throughput: 10_000,
                statusCode: 200,
                timestamp: new Date(),
                responseSize: 0,
              },
              success: true,
              retryCount: 0,
            },
          ],
          summary: {
            totalMethods: 1,
            successfulMethods: 1,
            failedMethods: 0,
            fastestMethod: "direct",
            fastestLatency: 400,
          },
          testedAt: new Date(),
        };
      });

      await service.performAllRetrievals(buildDeal());

      const labels = {
        checkType: "retrieval",
        providerId: "7",
        providerName: "Test SP",
        providerStatus: "unapproved",
      };

      expect(mockRetrievalMetrics.observeCheckDuration).toHaveBeenCalledWith(labels, 2500);
      expect(mockRetrievalMetrics.observeFirstByteMs).toHaveBeenCalledWith(labels, 100);
      expect(mockRetrievalMetrics.observeLastByteMs).toHaveBeenCalledWith(labels, 400);
      expect(mockRetrievalMetrics.observeThroughput).toHaveBeenCalledWith(labels, 10_000);
      expect(mockRetrievalMetrics.recordStatus).toHaveBeenCalledWith(labels, "pending");
      expect(mockRetrievalMetrics.recordStatus).toHaveBeenCalledWith(labels, "success");
      expect(mockRetrievalMetrics.recordHttpResponseCode).toHaveBeenCalledWith(labels, 200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("records timed out retrieval status when retrieval throws", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    service = await createService();
    mockSpRepository.findOne.mockResolvedValue({ address: "0xsp", providerId: 7, isApproved: false, name: "Test SP" });
    mockRetrievalAddonsService.testAllRetrievalMethods.mockImplementation(async () => {
      vi.advanceTimersByTime(1750);
      throw new Error("timeout");
    });

    await expect(service.performAllRetrievals(buildDeal())).rejects.toThrow("timeout");

    const labels = {
      checkType: "retrieval",
      providerId: "7",
      providerName: "Test SP",
      providerStatus: "unapproved",
    };

    expect(mockRetrievalMetrics.recordStatus).toHaveBeenCalledWith(labels, "pending");
    expect(mockRetrievalMetrics.recordStatus).toHaveBeenCalledWith(labels, "failure.timedout");
    expect(mockRetrievalMetrics.observeCheckDuration).toHaveBeenCalledWith(labels, 1750);
  });

  it("records timed out status for partial results when signal aborts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    service = await createService();
    const abortController = new AbortController();
    mockSpRepository.findOne.mockResolvedValue({ address: "0xsp", providerId: 7, isApproved: false, name: "Test SP" });
    mockRetrievalRepository.create.mockImplementation(
      (data: Parameters<typeof mockRetrievalRepository.create>[0]) =>
        data as ReturnType<typeof mockRetrievalRepository.create>,
    );
    mockRetrievalRepository.save.mockImplementation(
      async (data: Parameters<typeof mockRetrievalRepository.save>[0]) =>
        data as ReturnType<typeof mockRetrievalRepository.save>,
    );

    mockRetrievalAddonsService.testAllRetrievalMethods.mockImplementation(async () => {
      vi.advanceTimersByTime(900);
      abortController.abort(new Error("retrieval timeout"));

      return {
        dealId: "deal-1",
        results: [
          {
            url: "http://example.com",
            method: "direct",
            data: Buffer.alloc(0),
            metrics: {
              latency: 100,
              ttfb: 50,
              throughput: 5000,
              statusCode: 504,
              timestamp: new Date(),
              responseSize: 0,
            },
            success: false,
            error: "timeout",
            retryCount: 0,
          },
        ],
        summary: {
          totalMethods: 1,
          successfulMethods: 0,
          failedMethods: 1,
          fastestMethod: undefined,
          fastestLatency: undefined,
        },
        testedAt: new Date(),
        aborted: true,
      };
    });

    const retrievals = await service.performAllRetrievals(buildDeal(), abortController.signal);

    const labels = {
      checkType: "retrieval",
      providerId: "7",
      providerName: "Test SP",
      providerStatus: "unapproved",
    };

    expect(retrievals).toHaveLength(1);
    expect(mockRetrievalMetrics.recordStatus).toHaveBeenCalledWith(labels, "pending");
    expect(mockRetrievalMetrics.recordStatus).toHaveBeenCalledWith(labels, "failure.timedout");
    expect(mockRetrievalMetrics.observeCheckDuration).toHaveBeenCalledWith(labels, 900);
  });
});

describe("RetrievalService parallel IPNI + transport", () => {
  type PublicInterface<T> = { [K in keyof T]: T[K] };
  type RetrievalServicePrivate = PublicInterface<RetrievalService> & {
    performAllRetrievals: (deal: Deal, signal?: AbortSignal) => Promise<Retrieval[]>;
  };

  let service: RetrievalServicePrivate;

  const mockRetrievalAddonsService = {
    testAllRetrievalMethods: vi.fn(),
    getApplicableStrategies: vi.fn().mockReturnValue([{}]),
  };
  const mockConfigService = {
    get: vi.fn((key: string) => {
      if (key === "app") return { runMode: "worker" };
      if (key === "jobs") return { pgbossSchedulerEnabled: true };
      if (key === "blockchain") return { network: "calibration" };
      if (key === "dataset") return { randomDatasetSizes: [10] };
      if (key === "timeouts") return { ipniVerificationTimeoutMs: 10_000, ipniVerificationPollingMs: 2_000 };
      return undefined;
    }),
  };
  const mockIpniVerificationService = { verify: vi.fn() };
  const mockDiscoverabilityMetrics = { recordStatus: vi.fn(), observeIpniVerifyMs: vi.fn() };
  const mockDealRepository = { find: vi.fn() };
  const mockRetrievalRepository = { create: vi.fn(), save: vi.fn() };
  const mockSpRepository = { findOne: vi.fn() };
  const mockRetrievalMetrics = {
    observeFirstByteMs: vi.fn(),
    observeLastByteMs: vi.fn(),
    observeThroughput: vi.fn(),
    observeCheckDuration: vi.fn(),
    recordStatus: vi.fn(),
    recordHttpResponseCode: vi.fn(),
    recordResultMetrics: vi.fn(),
  };

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const buildDealWithIpni = (): Deal =>
    ({
      id: "deal-1",
      spAddress: "0xsp",
      walletAddress: "0xwallet",
      pieceCid: "bafy-piece",
      dataSetId: "13006",
      pieceId: 42,
      metadata: {
        ipfs_pin: {
          rootCID: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
          blockCIDs: ["bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"],
        },
      },
    }) as unknown as Deal;

  const labels = {
    checkType: "retrieval",
    providerId: "7",
    providerName: "Test SP",
    providerStatus: "unapproved",
  };

  const successfulTransport = {
    dealId: "deal-1",
    results: [
      {
        url: "http://example.com",
        method: "direct",
        data: Buffer.alloc(0),
        metrics: {
          latency: 100,
          ttfb: 50,
          throughput: 5000,
          statusCode: 200,
          timestamp: new Date(),
          responseSize: 0,
        },
        success: true,
        retryCount: 0,
      },
    ],
    summary: {
      totalMethods: 1,
      successfulMethods: 1,
      failedMethods: 0,
      fastestMethod: "direct",
      fastestLatency: 100,
    },
    testedAt: new Date(),
  };

  const createService = async (): Promise<RetrievalServicePrivate> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetrievalService,
        { provide: RetrievalAddonsService, useValue: mockRetrievalAddonsService },
        { provide: getRepositoryToken(Deal), useValue: mockDealRepository },
        { provide: getRepositoryToken(Retrieval), useValue: mockRetrievalRepository },
        { provide: getRepositoryToken(StorageProvider), useValue: mockSpRepository },
        { provide: RetrievalCheckMetrics, useValue: mockRetrievalMetrics },
        { provide: DiscoverabilityCheckMetrics, useValue: mockDiscoverabilityMetrics },
        { provide: IpniVerificationService, useValue: mockIpniVerificationService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ClickhouseService, useValue: { insert: vi.fn(), probeLocation: "test" } },
        {
          provide: DatasetLivenessService,
          useValue: {
            isDataSetLive: vi.fn().mockResolvedValue(true),
            isPieceLive: vi.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();
    return module.get<RetrievalService>(RetrievalService) as unknown as RetrievalServicePrivate;
  };

  const setupCommonMocks = (): void => {
    mockSpRepository.findOne.mockResolvedValue({
      address: "0xsp",
      providerId: 7,
      isApproved: false,
      name: "Test SP",
    });
    mockRetrievalRepository.create.mockImplementation((d) => d);
    mockRetrievalRepository.save.mockImplementation(async (d) => d);
  };

  it("emits success on retrievalStatus and discoverabilityStatus when IPNI and transport both succeed", async () => {
    service = await createService();
    setupCommonMocks();
    mockIpniVerificationService.verify.mockResolvedValue({
      verified: 1,
      unverified: 0,
      total: 1,
      rootCIDVerified: true,
      durationMs: 1000,
      failedCIDs: [],
      verifiedAt: new Date().toISOString(),
    });
    mockRetrievalAddonsService.testAllRetrievalMethods.mockResolvedValue(successfulTransport);

    await service.performAllRetrievals(buildDealWithIpni());

    expect(mockRetrievalMetrics.recordStatus).toHaveBeenCalledWith(labels, "pending");
    expect(mockRetrievalMetrics.recordStatus).toHaveBeenCalledWith(labels, "success");
    expect(mockDiscoverabilityMetrics.recordStatus).toHaveBeenCalledWith(labels, "success");
  });

  it("keeps retrievalStatus=success when IPNI fails but transport succeeds (IPNI outcome recorded on discoverabilityStatus)", async () => {
    service = await createService();
    setupCommonMocks();
    mockIpniVerificationService.verify.mockResolvedValue({
      verified: 0,
      unverified: 1,
      total: 1,
      rootCIDVerified: false,
      durationMs: 500,
      failedCIDs: [{ cid: "x", reason: "missing" }],
      verifiedAt: new Date().toISOString(),
    });
    mockRetrievalAddonsService.testAllRetrievalMethods.mockResolvedValue(successfulTransport);

    await service.performAllRetrievals(buildDealWithIpni());

    expect(mockRetrievalMetrics.recordStatus).toHaveBeenCalledWith(labels, "success");
    expect(mockDiscoverabilityMetrics.recordStatus).toHaveBeenCalledWith(labels, "failure.other");
  });

  it("keeps retrievalStatus=success when IPNI times out but transport succeeds (timeout recorded on discoverabilityStatus)", async () => {
    service = await createService();
    setupCommonMocks();
    mockIpniVerificationService.verify.mockResolvedValue({
      verified: 0,
      unverified: 1,
      total: 1,
      rootCIDVerified: false,
      durationMs: 10_000,
      failedCIDs: [{ cid: "x", reason: "timeout" }],
      verifiedAt: new Date().toISOString(),
    });
    mockRetrievalAddonsService.testAllRetrievalMethods.mockResolvedValue(successfulTransport);

    await service.performAllRetrievals(buildDealWithIpni());

    expect(mockRetrievalMetrics.recordStatus).toHaveBeenCalledWith(labels, "success");
    expect(mockDiscoverabilityMetrics.recordStatus).toHaveBeenCalledWith(labels, "failure.timedout");
  });

  it("logs retrieval_ipni_verification_timed_out when outer signal aborts and IPNI verify throws", async () => {
    service = await createService();
    setupCommonMocks();
    const loggerWarn = vi.spyOn((service as unknown as { logger: { warn: (m: object) => void } }).logger, "warn");
    const abortController = new AbortController();
    mockIpniVerificationService.verify.mockImplementation(async () => {
      abortController.abort(new Error("outer timeout"));
      throw new Error("ipni aborted");
    });
    mockRetrievalAddonsService.testAllRetrievalMethods.mockResolvedValue(successfulTransport);

    await service.performAllRetrievals(buildDealWithIpni(), abortController.signal);

    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "retrieval_ipni_verification_timed_out" }),
    );
    expect(mockRetrievalMetrics.recordStatus).toHaveBeenCalledWith(labels, "failure.timedout");
  });

  it("runs IPNI and transport concurrently", async () => {
    service = await createService();
    setupCommonMocks();

    const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    };

    // Each side signals when it has been entered, then awaits a shared release barrier.
    // If execution were sequential, the second `started` would never resolve before the
    // first call returned — so awaiting both starts proves both ran concurrently.
    const ipniStarted = deferred<void>();
    const transportStarted = deferred<void>();
    const release = deferred<void>();

    mockIpniVerificationService.verify.mockImplementation(async () => {
      ipniStarted.resolve();
      await release.promise;
      return {
        verified: 1,
        unverified: 0,
        total: 1,
        rootCIDVerified: true,
        durationMs: 0,
        failedCIDs: [],
        verifiedAt: new Date().toISOString(),
      };
    });
    mockRetrievalAddonsService.testAllRetrievalMethods.mockImplementation(async () => {
      transportStarted.resolve();
      await release.promise;
      return successfulTransport;
    });

    const runPromise = service.performAllRetrievals(buildDealWithIpni());

    await Promise.all([ipniStarted.promise, transportStarted.promise]);
    release.resolve();
    await runPromise;
  });
});

describe("RetrievalService DB/provider drift", () => {
  const mockConfigService = {
    get: vi.fn((key: string) => {
      if (key === "jobs") return { mode: "cron" };
      if (key === "blockchain") return { useOnlyApprovedProviders: false };
      if (key === "dataset") return { randomDatasetSizes: [10] };
      if (key === "timeouts") return { ipniVerificationTimeoutMs: 10_000, ipniVerificationPollingMs: 2_000 };
      return undefined;
    }),
  };

  function createMockQueryBuilder() {
    const calls: Array<{ clause: string; params?: Record<string, unknown> }> = [];
    const qb = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn((clause: string, params?: Record<string, unknown>) => {
        calls.push({ clause, params });
        return qb;
      }),
      orderBy: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
      getOne: vi.fn().mockResolvedValue(null),
    };
    return { qb, calls };
  }

  async function createServiceWithQb(mockQb: ReturnType<typeof createMockQueryBuilder>["qb"]) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetrievalService,
        { provide: RetrievalAddonsService, useValue: {} },
        { provide: getRepositoryToken(Deal), useValue: { createQueryBuilder: vi.fn().mockReturnValue(mockQb) } },
        { provide: getRepositoryToken(Retrieval), useValue: {} },
        { provide: getRepositoryToken(StorageProvider), useValue: {} },
        { provide: RetrievalCheckMetrics, useValue: {} },
        { provide: DiscoverabilityCheckMetrics, useValue: {} },
        { provide: IpniVerificationService, useValue: {} },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ClickhouseService, useValue: { insert: vi.fn(), probeLocation: "test" } },
        {
          provide: DatasetLivenessService,
          useValue: {
            isDataSetLive: vi.fn().mockResolvedValue(true),
            isPieceLive: vi.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();
    return module.get<RetrievalService>(RetrievalService);
  }

  it("selectRandomSuccessfulDealForProvider excludes cleaned-up deals", async () => {
    const { qb, calls } = createMockQueryBuilder();
    const svc = (await createServiceWithQb(qb)) as unknown as {
      selectRandomSuccessfulDealForProvider: (spAddress: string) => Promise<Deal | null>;
    };

    await svc.selectRandomSuccessfulDealForProvider("0xSP");

    const cleanedUpCall = calls.find((c) => c.clause.includes("cleaned_up"));
    expect(cleanedUpCall).toBeDefined();
    expect(cleanedUpCall?.params).toEqual({ cleanedUp: false });
  });
});

describe("RetrievalService SP piece status pre-flight", () => {
  type PublicInterface<T> = { [K in keyof T]: T[K] };
  type RetrievalServicePrivate = PublicInterface<RetrievalService> & {
    performAllRetrievals: (deal: Deal, signal?: AbortSignal) => Promise<Retrieval[]>;
  };

  const mockRetrievalAddonsService = {
    testAllRetrievalMethods: vi.fn().mockResolvedValue({
      dealId: "deal-1",
      results: [],
      summary: { totalMethods: 0, successfulMethods: 0, failedMethods: 0 },
      testedAt: new Date(),
    }),
    getApplicableStrategies: vi.fn().mockReturnValue([{}]),
  };
  const mockConfigService = {
    get: vi.fn((key: string) => {
      if (key === "app") return { runMode: "api" };
      if (key === "jobs") return { pgbossSchedulerEnabled: false };
      if (key === "blockchain") return { network: "calibration" };
      if (key === "dataset") return { randomDatasetSizes: [] };
      return undefined;
    }),
  };
  const mockDealRepository = {
    update: vi.fn().mockResolvedValue({ affected: 1 }),
  };
  const mockSpRepository = { findOne: vi.fn() };
  const mockRetrievalMetrics = {
    observeCheckDuration: vi.fn(),
    recordStatus: vi.fn(),
    observeFirstByteMs: vi.fn(),
    observeLastByteMs: vi.fn(),
    observeThroughput: vi.fn(),
    recordHttpResponseCode: vi.fn(),
    recordResultMetrics: vi.fn(),
  };
  const mockRetrievalRepositoryLocal = {
    create: vi.fn((row: Partial<Retrieval>) => row as Retrieval),
    save: vi.fn(async (row: Retrieval) => row),
  };
  const mockDatasetLivenessService = {
    isDataSetLive: vi.fn().mockResolvedValue(true),
    isPieceLive: vi.fn().mockResolvedValue(true),
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mockDealRepository.update.mockClear();
    mockRetrievalAddonsService.testAllRetrievalMethods.mockClear();
    mockRetrievalMetrics.recordStatus.mockClear();
    mockRetrievalRepositoryLocal.create.mockClear();
    mockRetrievalRepositoryLocal.save.mockClear();
    mockDatasetLivenessService.isDataSetLive.mockReset().mockResolvedValue(true);
    mockDatasetLivenessService.isPieceLive.mockReset().mockResolvedValue(true);
  });

  const buildDeal = (overrides: Partial<Deal> = {}): Deal =>
    ({
      id: "deal-1",
      spAddress: "0xsp",
      walletAddress: "0xwallet",
      pieceCid: "bafy-piece",
      dataSetId: "13006",
      pieceId: 42,
      ...overrides,
    }) as Deal;

  const createService = async (): Promise<RetrievalServicePrivate> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetrievalService,
        { provide: RetrievalAddonsService, useValue: mockRetrievalAddonsService },
        { provide: getRepositoryToken(Deal), useValue: mockDealRepository },
        { provide: getRepositoryToken(Retrieval), useValue: mockRetrievalRepositoryLocal },
        { provide: getRepositoryToken(StorageProvider), useValue: mockSpRepository },
        { provide: RetrievalCheckMetrics, useValue: mockRetrievalMetrics },
        { provide: DiscoverabilityCheckMetrics, useValue: { recordStatus: vi.fn(), observeIpniVerifyMs: vi.fn() } },
        { provide: IpniVerificationService, useValue: { verify: vi.fn() } },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ClickhouseService, useValue: { insert: vi.fn(), probeLocation: "test" } },
        { provide: DatasetLivenessService, useValue: mockDatasetLivenessService },
      ],
    }).compile();
    return module.get<RetrievalService>(RetrievalService) as unknown as RetrievalServicePrivate;
  };

  it("emits failure.other and bails when deal has null dataSetId or pieceId", async () => {
    const service = await createService();
    mockSpRepository.findOne.mockResolvedValue({
      address: "0xsp",
      providerId: 5,
      isApproved: true,
      name: "Test SP",
      serviceUrl: "https://sp.example.com",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await service.performAllRetrievals(buildDeal({ pieceId: null as unknown as number }));

    expect(result).toEqual([]);
    expect(mockDealRepository.update).not.toHaveBeenCalled();
    expect(mockDatasetLivenessService.isPieceLive).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockRetrievalAddonsService.testAllRetrievalMethods).not.toHaveBeenCalled();
    expect(mockRetrievalMetrics.recordStatus).toHaveBeenCalledWith(expect.any(Object), "failure.other");
  });

  it("marks deal cleaned_up and skips retrieval when PDP pieceLive=false (no SP probe)", async () => {
    const service = await createService();
    mockSpRepository.findOne.mockResolvedValue({
      address: "0xsp",
      providerId: 5,
      isApproved: true,
      name: "Test SP",
      serviceUrl: "https://sp.example.com",
    });
    mockDatasetLivenessService.isPieceLive.mockResolvedValueOnce(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await service.performAllRetrievals(buildDeal());

    expect(result).toEqual([]);
    expect(mockDealRepository.update).toHaveBeenCalledWith(
      { id: "deal-1", cleanedUp: false },
      expect.objectContaining({ cleanedUp: true, cleanedUpAt: expect.any(Date) }),
    );
    expect(mockRetrievalAddonsService.testAllRetrievalMethods).not.toHaveBeenCalled();
    expect(mockRetrievalMetrics.recordStatus).toHaveBeenCalledWith(expect.any(Object), "skipped.piece_missing");
    // No SP probe when chain says piece is gone
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records a failed retrieval (failure.other) when SP returns 404 but pieceLive=true", async () => {
    const service = await createService();
    mockSpRepository.findOne.mockResolvedValue({
      address: "0xsp",
      providerId: 5,
      isApproved: true,
      name: "Test SP",
      serviceUrl: "https://sp.example.com",
    });
    mockDatasetLivenessService.isPieceLive.mockResolvedValueOnce(true);
    const fetchMock = vi.fn().mockResolvedValue({ status: 404, ok: false } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await service.performAllRetrievals(buildDeal());

    expect(result).toHaveLength(1);
    expect(mockDealRepository.update).not.toHaveBeenCalled();
    expect(mockRetrievalAddonsService.testAllRetrievalMethods).not.toHaveBeenCalled();
    expect(mockRetrievalMetrics.recordStatus).toHaveBeenCalledWith(expect.any(Object), "failure.other");
    expect(mockRetrievalRepositoryLocal.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: RetrievalStatus.FAILED,
        responseCode: 404,
        errorMessage: expect.stringContaining("pieceLive=true"),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://sp.example.com/pdp/piece/bafy-piece/status",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("proceeds with retrieval when SP confirms piece exists", async () => {
    const service = await createService();
    mockSpRepository.findOne.mockResolvedValue({
      address: "0xsp",
      providerId: 5,
      isApproved: true,
      name: "Test SP",
      serviceUrl: "https://sp.example.com",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, ok: true } as Response));

    await service.performAllRetrievals(buildDeal()).catch(() => undefined);

    expect(mockDealRepository.update).not.toHaveBeenCalled();
    expect(mockRetrievalAddonsService.testAllRetrievalMethods).toHaveBeenCalled();
  });

  it("proceeds with retrieval when SP probe fails with a network error (unknown)", async () => {
    const service = await createService();
    mockSpRepository.findOne.mockResolvedValue({
      address: "0xsp",
      providerId: 5,
      isApproved: true,
      name: "Test SP",
      serviceUrl: "https://sp.example.com",
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unreachable")));

    await service.performAllRetrievals(buildDeal()).catch(() => undefined);

    expect(mockDealRepository.update).not.toHaveBeenCalled();
    expect(mockRetrievalAddonsService.testAllRetrievalMethods).toHaveBeenCalled();
  });

  it("skips probe and proceeds when provider has no serviceUrl", async () => {
    const service = await createService();
    mockSpRepository.findOne.mockResolvedValue({
      address: "0xsp",
      providerId: 5,
      isApproved: true,
      name: "Test SP",
      serviceUrl: null,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await service.performAllRetrievals(buildDeal()).catch(() => undefined);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockDealRepository.update).not.toHaveBeenCalled();
  });

  it("re-throws when the outer signal aborts during the probe", async () => {
    const service = await createService();
    mockSpRepository.findOne.mockResolvedValue({
      address: "0xsp",
      providerId: 5,
      isApproved: true,
      name: "Test SP",
      serviceUrl: "https://sp.example.com",
    });
    const ac = new AbortController();
    const fetchMock = vi.fn().mockImplementation(() => {
      ac.abort(new Error("cancelled by job"));
      return Promise.reject(new DOMException("aborted", "AbortError"));
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(service.performAllRetrievals(buildDeal(), ac.signal)).rejects.toThrow();
    expect(mockDealRepository.update).not.toHaveBeenCalled();
    expect(mockRetrievalAddonsService.testAllRetrievalMethods).not.toHaveBeenCalled();
  });

  it("strips trailing slash from serviceUrl and URL-encodes the pieceCid", async () => {
    const service = await createService();
    mockSpRepository.findOne.mockResolvedValue({
      address: "0xsp",
      providerId: 5,
      isApproved: true,
      name: "Test SP",
      serviceUrl: "https://sp.example.com/",
    });
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await service.performAllRetrievals(buildDeal({ pieceCid: "bafy/with/slashes" })).catch(() => undefined);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://sp.example.com/pdp/piece/bafy%2Fwith%2Fslashes/status",
      expect.any(Object),
    );
  });
});
