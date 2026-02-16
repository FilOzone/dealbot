import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { getToken } from "@willsoto/nestjs-prometheus";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Deal } from "../database/entities/deal.entity.js";
import { Retrieval } from "../database/entities/retrieval.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { RetrievalStatus } from "../database/types.js";
import { RetrievalAddonsService } from "../retrieval-addons/retrieval-addons.service.js";
import { RetrievalService } from "./retrieval.service.js";

describe("RetrievalService timeouts", () => {
  // Mapped type strips private members so the intersection doesn't collapse to `never`.
  type PublicInterface<T> = { [K in keyof T]: T[K] };
  type RetrievalServicePrivate = PublicInterface<RetrievalService> & {
    processRetrievalsInParallel: (
      deals: Deal[],
      options: { timeoutMs: number; maxConcurrency?: number; signal?: AbortSignal },
    ) => Promise<Retrieval[][]>;
    performAllRetrievals: (deal: Deal, signal?: AbortSignal) => Promise<Retrieval[]>;
  };

  let service: RetrievalServicePrivate;
  let performAllRetrievalsSpy: ReturnType<typeof vi.spyOn>;

  const mockRetrievalAddonsService = {
    testAllRetrievalMethods: vi.fn(),
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
  const mockRetrievalsTestedCounter = { inc: vi.fn() };
  const mockRetrievalLatency = { observe: vi.fn() };
  const mockRetrievalTtfb = { observe: vi.fn() };

  const defaultTimeouts = {
    httpRequestTimeoutMs: 10000,
    http2RequestTimeoutMs: 10000,
    connectTimeoutMs: 10000,
    retrievalTimeoutBufferMs: 60000,
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

  const createService = async (timeouts = defaultTimeouts): Promise<RetrievalServicePrivate> => {
    const configService = {
      get: vi.fn((key: string) => (key === "timeouts" ? timeouts : undefined)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetrievalService,
        { provide: RetrievalAddonsService, useValue: mockRetrievalAddonsService },
        { provide: ConfigService, useValue: configService },
        { provide: getRepositoryToken(Deal), useValue: mockDealRepository },
        { provide: getRepositoryToken(Retrieval), useValue: mockRetrievalRepository },
        { provide: getRepositoryToken(StorageProvider), useValue: mockSpRepository },
        { provide: getToken("retrievals_tested_total"), useValue: mockRetrievalsTestedCounter },
        { provide: getToken("retrieval_latency_seconds"), useValue: mockRetrievalLatency },
        { provide: getToken("retrieval_ttfb_seconds"), useValue: mockRetrievalTtfb },
      ],
    }).compile();

    return module.get<RetrievalService>(RetrievalService) as unknown as RetrievalServicePrivate;
  };

  it("starts a batch when there is enough time remaining for a full HTTP timeout", async () => {
    service = await createService();
    performAllRetrievalsSpy = vi.spyOn(service, "performAllRetrievals").mockResolvedValue([]);
    vi.spyOn(Date, "now").mockReturnValue(0);

    const results = await service.processRetrievalsInParallel([buildDeal()], {
      timeoutMs: 20000,
      maxConcurrency: 1,
    });

    expect(performAllRetrievalsSpy).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });

  it("skips starting a batch when remaining time is less than the HTTP timeout", async () => {
    service = await createService();
    performAllRetrievalsSpy = vi.spyOn(service, "performAllRetrievals").mockResolvedValue([]);
    vi.spyOn(Date, "now").mockReturnValue(0);

    const results = await service.processRetrievalsInParallel([buildDeal()], {
      timeoutMs: 5000,
      maxConcurrency: 1,
    });

    expect(performAllRetrievalsSpy).not.toHaveBeenCalled();
    expect(results).toHaveLength(0);
  });

  it("times out a retrieval when the batch timeout is exceeded", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    service = await createService({
      ...defaultTimeouts,
      httpRequestTimeoutMs: 50,
      http2RequestTimeoutMs: 50,
    });

    performAllRetrievalsSpy = vi.spyOn(service, "performAllRetrievals").mockImplementation(() => new Promise(() => {}));

    const promise = service.processRetrievalsInParallel([buildDeal()], {
      timeoutMs: 200,
      maxConcurrency: 1,
    });

    await vi.advanceTimersByTimeAsync(100);

    const results = await promise;

    expect(performAllRetrievalsSpy).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(0);

    // Note: the underlying retrieval promise remains pending; timeouts don't cancel work.
    // Cancellation is handled by the scheduler abort signal in real runs.
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
        timeoutMs: 20000,
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
      dealId: 1,
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
});
