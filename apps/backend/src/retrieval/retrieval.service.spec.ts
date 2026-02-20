import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Deal } from "../database/entities/deal.entity.js";
import { Retrieval } from "../database/entities/retrieval.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { RetrievalStatus } from "../database/types.js";
import { IpniVerificationService } from "../ipni/ipni-verification.service.js";
import { DiscoverabilityCheckMetrics, RetrievalCheckMetrics } from "../metrics/utils/check-metrics.service.js";
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
  let performAllRetrievalsSpy: ReturnType<typeof vi.spyOn>;

  const mockRetrievalAddonsService = {
    testAllRetrievalMethods: vi.fn(),
    getApplicableStrategies: vi.fn().mockReturnValue([{}]),
  };
  const mockConfigService = {
    get: vi.fn((key: string) => {
      if (key === "jobs") return { mode: "cron" };
      if (key === "dataset") return { randomDatasetSizes: [10] };
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
      ],
    }).compile();

    return module.get<RetrievalService>(RetrievalService) as unknown as RetrievalServicePrivate;
  };

  it("processes all deals when no abort signal is triggered", async () => {
    service = await createService();
    performAllRetrievalsSpy = vi.spyOn(service, "performAllRetrievals").mockResolvedValue([]);

    const results = await service.processRetrievalsInParallel([buildDeal()], {
      maxConcurrency: 1,
    });

    expect(performAllRetrievalsSpy).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });

  it("aborts processing remaining deals when signal is aborted", async () => {
    service = await createService();
    const abortController = new AbortController();

    performAllRetrievalsSpy = vi.spyOn(service, "performAllRetrievals").mockImplementation(async () => {
      abortController.abort();
      return [];
    });

    // 2 deals, maxConcurrency 1. First deal aborts, second should be skipped.
    const results = await service.processRetrievalsInParallel(
      [buildDeal({ id: "deal-1" }), buildDeal({ id: "deal-2" })],
      {
        maxConcurrency: 1,
        signal: abortController.signal,
      },
    );

    expect(performAllRetrievalsSpy).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1); // Only the first batch (of 1) should return results
  });

  it("passes abort signal to performAllRetrievals", async () => {
    service = await createService();
    const abortController = new AbortController();
    performAllRetrievalsSpy = vi.spyOn(service, "performAllRetrievals").mockResolvedValue([]);

    await service.processRetrievalsInParallel([buildDeal()], {
      maxConcurrency: 1,
      signal: abortController.signal,
    });

    expect(performAllRetrievalsSpy).toHaveBeenCalledWith(expect.anything(), abortController.signal);
  });

  it("returns partial results when aborted between batches", async () => {
    service = await createService();
    const abortController = new AbortController();

    performAllRetrievalsSpy = vi.spyOn(service, "performAllRetrievals").mockImplementationOnce(async () => {
      abortController.abort();
      return [];
    });

    const results = await service.processRetrievalsInParallel(
      [buildDeal({ id: "deal-1" }), buildDeal({ id: "deal-2" })],
      {
        maxConcurrency: 1,
        signal: abortController.signal,
      },
    );

    expect(performAllRetrievalsSpy).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });

  it("records a failed retrieval when an execution result fails", async () => {
    service = await createService();

    const timeoutError = "HTTP request timed out after 50ms";
    mockSpRepository.findOne.mockResolvedValue({ address: "0xsp" });
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

      mockSpRepository.findOne.mockResolvedValue({ address: "0xsp", providerId: 7, isApproved: false });
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
    service = await createService();
    mockSpRepository.findOne.mockResolvedValue({ address: "0xsp", providerId: 7, isApproved: false });
    mockRetrievalAddonsService.testAllRetrievalMethods.mockRejectedValue(new Error("timeout"));

    await expect(service.performAllRetrievals(buildDeal())).rejects.toThrow("timeout");

    const labels = {
      checkType: "retrieval",
      providerId: "7",
      providerStatus: "unapproved",
    };

    expect(mockRetrievalMetrics.recordStatus).toHaveBeenCalledWith(labels, "pending");
    expect(mockRetrievalMetrics.recordStatus).toHaveBeenCalledWith(labels, "failure.timedout");
  });
});
