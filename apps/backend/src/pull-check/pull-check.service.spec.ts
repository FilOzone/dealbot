import { Readable } from "node:stream";
import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IConfig } from "../config/app.config.js";
import { DataSourceService } from "../dataSource/dataSource.service.js";
import { HttpClientService } from "../http-client/http-client.service.js";
import { PullCheckCheckMetrics } from "../metrics-prometheus/check-metrics.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import type { PDPProviderEx } from "../wallet-sdk/wallet-sdk.types.js";
import { PullCheckService } from "./pull-check.service.js";
import { PullPieceRepository } from "./pull-piece.repository.js";

// `@filoz/synapse-core/piece` is mocked so that piece CIDs are deterministic
// strings rather than real CID objects, keeping the tests fast and isolated
// from the SDK's internal hashing.
vi.mock("@filoz/synapse-core/piece", () => ({
  parse: vi.fn((s: string) => ({ __parsed: s, toString: () => s })),
  calculate: vi.fn(() => ({ toString: () => "bafk-test-piece" })),
  calculateFromIterable: vi.fn().mockResolvedValue("bafk-test-piece"),
}));

vi.mock("@filoz/synapse-core/sp", () => ({
  pullPieces: vi.fn(),
  waitForPullPieces: vi.fn(),
}));

import { calculateFromIterable } from "@filoz/synapse-core/piece";
import { pullPieces, waitForPullPieces } from "@filoz/synapse-core/sp";

function makeProvider(overrides: Partial<PDPProviderEx> = {}): PDPProviderEx {
  return {
    id: 42n,
    name: "test-sp",
    payee: "0xpayee",
    isActive: true,
    isApproved: true,
    pdp: {
      serviceURL: "https://sp.example/",
    },
    ...overrides,
  } as unknown as PDPProviderEx;
}

describe("PullCheckService", () => {
  let module: TestingModule;
  let service: PullCheckService;
  let walletSdkServiceMock: { getProviderInfo: ReturnType<typeof vi.fn>; getSynapseClient: ReturnType<typeof vi.fn> };
  let dataSourceServiceMock: {
    generateBytesStream: ReturnType<typeof vi.fn>;
  };
  let registryMock: {
    register: ReturnType<typeof vi.fn>;
    resolve: ReturnType<typeof vi.fn>;
    markPullSubmitted: ReturnType<typeof vi.fn>;
    markFirstByte: ReturnType<typeof vi.fn>;
    forget: ReturnType<typeof vi.fn>;
    deleteExpired: ReturnType<typeof vi.fn>;
  };
  let httpClientServiceMock: { requestWithMetrics: ReturnType<typeof vi.fn>; requestStream: ReturnType<typeof vi.fn> };
  let metricsMock: {
    observeAcknowledgementLatencyMs: ReturnType<typeof vi.fn>;
    observeStartedMs: ReturnType<typeof vi.fn>;
    observeCompletionLatencyMs: ReturnType<typeof vi.fn>;
    recordProviderStatus: ReturnType<typeof vi.fn>;
    observeThroughputBps: ReturnType<typeof vi.fn>;
    recordStatus: ReturnType<typeof vi.fn>;
  };
  let configValues: Partial<IConfig>;

  beforeEach(async () => {
    walletSdkServiceMock = {
      getProviderInfo: vi.fn().mockReturnValue(makeProvider()),
      getSynapseClient: vi.fn().mockReturnValue({}),
    };
    dataSourceServiceMock = {
      generateBytesStream: vi.fn().mockReturnValue(Readable.from([Buffer.alloc(10)])),
    };
    registryMock = {
      register: vi.fn().mockResolvedValue(undefined),
      resolve: vi.fn().mockResolvedValue(null),
      markPullSubmitted: vi.fn().mockResolvedValue(undefined),
      markFirstByte: vi.fn().mockResolvedValue(undefined),
      forget: vi.fn().mockResolvedValue(undefined),
      deleteExpired: vi.fn().mockResolvedValue(0),
    };
    httpClientServiceMock = {
      requestWithMetrics: vi.fn(),
      requestStream: vi.fn(),
    };
    metricsMock = {
      observeAcknowledgementLatencyMs: vi.fn(),
      observeStartedMs: vi.fn(),
      observeCompletionLatencyMs: vi.fn(),
      recordProviderStatus: vi.fn(),
      observeThroughputBps: vi.fn(),
      recordStatus: vi.fn(),
    };

    configValues = {
      app: { host: "localhost", port: 3000, apiPublicUrl: "https://dealbot.example" } as IConfig["app"],
      blockchain: { network: "calibration", walletAddress: "0xwallet" } as IConfig["blockchain"],
      pullPiece: {
        pullChecksPerSpPerHour: 1,
        pullCheckJobTimeoutSeconds: 300,
        pullCheckPollIntervalSeconds: 5,
        pullCheckPieceSizeBytes: 1024,
        maxConcurrentStreams: 50,
        maxStreamsPerCid: 3,
        pullPieceCleanupIntervalSeconds: 7 * 24 * 3600,
      },
      dataset: { localDatasetsPath: "/tmp/datasets" } as IConfig["dataset"],
    };

    const configServiceMock = {
      get: vi.fn((key: keyof IConfig) => configValues[key]),
    };

    module = await Test.createTestingModule({
      providers: [
        PullCheckService,
        { provide: ConfigService, useValue: configServiceMock },
        { provide: WalletSdkService, useValue: walletSdkServiceMock },
        { provide: DataSourceService, useValue: dataSourceServiceMock },
        { provide: PullPieceRepository, useValue: registryMock },
        { provide: PullCheckCheckMetrics, useValue: metricsMock },
        { provide: HttpClientService, useValue: httpClientServiceMock },
      ],
    }).compile();

    service = module.get(PullCheckService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("validateProviderInfo", () => {
    it("returns the provider info on the happy path", () => {
      const provider = makeProvider();
      walletSdkServiceMock.getProviderInfo.mockReturnValue(provider);

      expect(service.validateProviderInfo("0xsp")).toBe(provider);
    });

    it("throws when the provider is unknown", () => {
      walletSdkServiceMock.getProviderInfo.mockReturnValue(undefined);
      expect(() => service.validateProviderInfo("0xsp")).toThrow(/not found/);
    });

    it("throws when the provider is inactive", () => {
      walletSdkServiceMock.getProviderInfo.mockReturnValue(makeProvider({ isActive: false }));
      expect(() => service.validateProviderInfo("0xsp")).toThrow(/not active/);
    });

    it("throws when the provider is missing a numeric id", () => {
      walletSdkServiceMock.getProviderInfo.mockReturnValue(makeProvider({ id: undefined as unknown as bigint }));
      expect(() => service.validateProviderInfo("0xsp")).toThrow(/missing providerId/);
    });

    it("throws when the provider is missing a PDP serviceURL", () => {
      walletSdkServiceMock.getProviderInfo.mockReturnValue(
        makeProvider({ pdp: { serviceURL: "" } as PDPProviderEx["pdp"] }),
      );
      expect(() => service.validateProviderInfo("0xsp")).toThrow(/missing serviceURL/);
    });
  });

  describe("preparePullPiece", () => {
    it("generates deterministic bytes, computes the piece CID, and registers the pull piece", async () => {
      const prepared = await service.preparePullPiece("0xsp");

      expect(dataSourceServiceMock.generateBytesStream).toHaveBeenCalledWith({
        providerAddress: "0xsp",
        key: expect.any(String),
        bytesNeeded: 1024,
      });
      expect(prepared.registration.pieceCid).toBe("bafk-test-piece");
      expect(prepared.registration.size).toBe(1024);
      expect(prepared.registration.expiresAt).toBeInstanceOf(Date);
      expect(prepared.sourceUrl).toBe("https://dealbot.example/api/piece/bafk-test-piece");
      expect(registryMock.register).toHaveBeenCalledWith(prepared.registration);
    });

    it("falls back to host:port when apiPublicUrl is not configured", async () => {
      configValues.app = { host: "localhost", port: 3000 } as IConfig["app"];

      const prepared = await service.preparePullPiece("0xsp");
      expect(prepared.sourceUrl).toBe("http://localhost:3000/api/piece/bafk-test-piece");
    });
  });

  describe("validateByDirectPieceFetch", () => {
    const provider = makeProvider();
    const logContext = { jobId: "job-1", providerAddress: "0xsp", providerId: 42n, providerName: "test-sp" };

    function makeStreamResponse(
      overrides: { statusCode?: number; headers?: Record<string, string>; cidResult?: string } = {},
    ) {
      const { statusCode = 200, headers = {}, cidResult = "bafk-test-piece" } = overrides;
      httpClientServiceMock.requestStream.mockResolvedValue({
        statusCode,
        headers: { "content-length": "1024", ...headers },
        body: Readable.from([Buffer.from("payload")]),
      });
      if (cidResult !== "bafk-test-piece") {
        vi.mocked(calculateFromIterable).mockResolvedValueOnce(cidResult as any);
      }
    }

    it("returns true when the recomputed CID matches", async () => {
      makeStreamResponse();

      const ok = await service.validateByDirectPieceFetch(provider, "bafk-test-piece", 1024, logContext);
      expect(ok).toBe(true);
      expect(httpClientServiceMock.requestStream).toHaveBeenCalledWith(
        "https://sp.example/piece/bafk-test-piece",
        expect.any(Object),
      );
    });

    it("returns false when the recomputed CID does not match", async () => {
      makeStreamResponse({ cidResult: "bafk-different" });

      const ok = await service.validateByDirectPieceFetch(provider, "bafk-test-piece", 1024, logContext);
      expect(ok).toBe(false);
    });

    it("returns false when the SP returns a non-2xx status", async () => {
      makeStreamResponse({ statusCode: 404 });

      const ok = await service.validateByDirectPieceFetch(provider, "bafk-test-piece", 1024, logContext);
      expect(ok).toBe(false);
    });

    it("returns false when Content-Length does not match expected piece size", async () => {
      makeStreamResponse({ headers: { "content-length": "9999" } });

      const ok = await service.validateByDirectPieceFetch(provider, "bafk-test-piece", 1024, logContext);
      expect(ok).toBe(false);
    });

    it("returns false on transport errors (caller branches on the boolean to record a domain failure)", async () => {
      httpClientServiceMock.requestStream.mockRejectedValue(new Error("ECONNRESET"));

      const ok = await service.validateByDirectPieceFetch(provider, "bafk-test-piece", 1024, logContext);
      expect(ok).toBe(false);
    });

    it("re-throws when the abort signal fires so cancellation is not masked as validation failure", async () => {
      const abort = new AbortController();
      httpClientServiceMock.requestStream.mockImplementation(async () => {
        abort.abort();
        throw new Error("aborted");
      });

      await expect(
        service.validateByDirectPieceFetch(provider, "bafk-test-piece", 1024, logContext, abort.signal),
      ).rejects.toThrow();
    });

    it("strips a trailing slash from the SP serviceURL when constructing the fetch URL", async () => {
      makeStreamResponse();

      await service.validateByDirectPieceFetch(provider, "bafk-test-piece", 1024, logContext);
      expect(httpClientServiceMock.requestStream).toHaveBeenCalledWith(
        "https://sp.example/piece/bafk-test-piece",
        expect.any(Object),
      );
    });
  });

  describe("runPullCheck", () => {
    const logContext = { jobId: "job-1", providerAddress: "0xsp", providerId: 42n, providerName: "test-sp" };

    function arrangeHappyPath() {
      // Pre-stage a registration that preparePullPiece will install.
      const registration = {
        pieceCid: "bafk-test-piece",
        providerAddress: "0xsp",
        key: "test-key",
        size: 1024,
        expiresAt: new Date(Date.now() + 60_000),
        cleanedUp: false,
        pullSubmittedAt: new Date("2030-01-01T00:00:00Z"),
        firstByteAt: new Date("2030-01-01T00:00:00.250Z"),
      };

      // After cleanup the resolveAny call returns the entry; before that the
      // run reads it once to compute first-byte latency. Same shape suffices.
      registryMock.resolve.mockResolvedValue(registration);

      vi.mocked(pullPieces).mockResolvedValue({ status: "pending" } as unknown as Awaited<
        ReturnType<typeof pullPieces>
      >);
      vi.mocked(waitForPullPieces).mockResolvedValue({
        status: "complete",
        pieces: [{ pieceCid: "bafk-test-piece", status: "complete" }],
      } as unknown as Awaited<ReturnType<typeof waitForPullPieces>>);

      // Direct-fetch validation succeeds.
      httpClientServiceMock.requestStream.mockResolvedValue({
        statusCode: 200,
        headers: { "content-length": "1024" },
        body: Readable.from([Buffer.from("payload")]),
      });

      return { registration };
    }

    it("runs the full lifecycle, observes all metrics, and records success", async () => {
      const { registration } = arrangeHappyPath();

      await service.runPullCheck("0xsp", undefined, logContext);

      // Submit timestamp is stamped on the registration.
      expect(registryMock.markPullSubmitted).toHaveBeenCalledWith(registration.pieceCid, expect.any(Date));
      // Latency histograms observed at least once each.
      expect(metricsMock.observeAcknowledgementLatencyMs).toHaveBeenCalledTimes(1);
      expect(metricsMock.observeCompletionLatencyMs).toHaveBeenCalledTimes(1);
      // Terminal SP status recorded exactly once.
      expect(metricsMock.recordProviderStatus).toHaveBeenCalledTimes(1);
      expect(metricsMock.recordProviderStatus).toHaveBeenCalledWith(expect.any(Object), "complete");
      // First-byte and throughput observed since the registration carries
      // pullSubmittedAt + firstByteAt and the path completed.
      expect(metricsMock.observeStartedMs).toHaveBeenCalledTimes(1);
      const firstByteMs = metricsMock.observeStartedMs.mock.calls[0][1] as number;
      expect(firstByteMs).toBe(250);
      expect(metricsMock.observeThroughputBps).toHaveBeenCalledTimes(1);
      // Terminal aggregate status is success.
      expect(metricsMock.recordStatus).toHaveBeenCalledWith(expect.any(Object), "success");

      // Eager forget removed; pieces expire via TTL rather than being deleted at job end.
      expect(registryMock.forget).not.toHaveBeenCalled();
    });

    it("does not observe firstByte when the SP never read from /api/piece (cached pull)", async () => {
      const { registration } = arrangeHappyPath();
      // Simulate a cached pull: SP never fetched from us.
      registryMock.resolve.mockResolvedValue({ ...registration, firstByteAt: undefined });

      await service.runPullCheck("0xsp", undefined, logContext);

      expect(metricsMock.observeStartedMs).not.toHaveBeenCalled();
      expect(metricsMock.observeThroughputBps).toHaveBeenCalledTimes(1);
      expect(metricsMock.recordStatus).toHaveBeenCalledWith(expect.any(Object), "success");
    });

    it("re-throws and records failure.other when the SP terminal status is not 'complete'", async () => {
      arrangeHappyPath();
      vi.mocked(waitForPullPieces).mockResolvedValue({
        status: "failed",
        pieces: [],
      } as unknown as Awaited<ReturnType<typeof waitForPullPieces>>);

      await expect(service.runPullCheck("0xsp", undefined, logContext)).rejects.toThrow(
        /Storage provider failed to pull piece/,
      );

      expect(metricsMock.recordProviderStatus).toHaveBeenCalledWith(expect.any(Object), "failed");
      expect(metricsMock.recordStatus).toHaveBeenLastCalledWith(expect.any(Object), "failure.other");
      expect(registryMock.forget).not.toHaveBeenCalled();
    });

    it("classifies timeouts as failure.timedout", async () => {
      arrangeHappyPath();
      vi.mocked(waitForPullPieces).mockRejectedValue(new Error("polling timed out after 300s"));

      await expect(service.runPullCheck("0xsp", undefined, logContext)).rejects.toThrow();
      expect(metricsMock.recordStatus).toHaveBeenLastCalledWith(expect.any(Object), "failure.timedout");
    });

    it("re-throws and runs cleanup when the validation step fails", async () => {
      arrangeHappyPath();
      // Force validation mismatch. Both `preparePullPiece` and
      // `validateByDirectPieceFetch` call `calculateFromIterable`, so chain
      // two one-shot mocks: the first satisfies prepare with the canonical
      // CID, the second makes the direct-fetch recompute disagree.
      vi.mocked(calculateFromIterable)
        .mockResolvedValueOnce("bafk-test-piece" as any)
        .mockResolvedValueOnce("bafk-mismatch" as any);

      await expect(service.runPullCheck("0xsp", undefined, logContext)).rejects.toThrow(/validation failed/);
      expect(metricsMock.recordStatus).toHaveBeenLastCalledWith(expect.any(Object), "failure.other");
      expect(registryMock.forget).not.toHaveBeenCalled();
    });

    it("re-throws when the abort signal fires before any work runs", async () => {
      arrangeHappyPath();
      const controller = new AbortController();
      controller.abort(new Error("Pull check job timeout (300s) for 0xsp"));

      await expect(service.runPullCheck("0xsp", controller.signal, logContext)).rejects.toThrow();
      // No SP-side calls were issued.
      expect(pullPieces).not.toHaveBeenCalled();
      expect(waitForPullPieces).not.toHaveBeenCalled();
      // Failure is classified as timed out (abort message contains "timeout").
      expect(metricsMock.recordStatus).toHaveBeenLastCalledWith(expect.any(Object), "failure.timedout");
    });

    it("re-throws when the synapse client is unavailable", async () => {
      arrangeHappyPath();
      walletSdkServiceMock.getSynapseClient.mockReturnValue(null);

      await expect(service.runPullCheck("0xsp", undefined, logContext)).rejects.toThrow(/Synapse client unavailable/);
      expect(metricsMock.recordStatus).toHaveBeenLastCalledWith(expect.any(Object), "failure.other");
    });
  });

  describe("deleteExpiredPullPieces", () => {
    it("delegates to the repository and returns the deleted count", async () => {
      registryMock.deleteExpired.mockResolvedValue(7);

      const count = await service.deleteExpiredPullPieces();

      expect(registryMock.deleteExpired).toHaveBeenCalledOnce();
      expect(count).toBe(7);
    });

    it("returns 0 when no rows were expired", async () => {
      registryMock.deleteExpired.mockResolvedValue(0);

      const count = await service.deleteExpiredPullPieces();

      expect(count).toBe(0);
    });
  });

  describe("openPullPieceStream", () => {
    it("returns null when no registration exists", async () => {
      registryMock.resolve.mockResolvedValue(null);
      expect(await service.openPullPieceStream("missing")).toBeNull();
    });

    it("returns active when the registration is within its TTL", async () => {
      const registration = {
        pieceCid: "bafk-test-piece",
        providerAddress: "0xsp",
        key: "test-key",
        size: 1024,
        expiresAt: new Date(Date.now() + 60_000),
      };
      registryMock.resolve.mockResolvedValue(registration);

      const result = await service.openPullPieceStream("bafk-test-piece");
      expect(result?.status).toBe("active");
      expect((result as Extract<typeof result, { status: "active" }>)?.registration).toEqual(registration);
      expect((result as Extract<typeof result, { status: "active" }>)?.stream).toBeDefined();
      expect(dataSourceServiceMock.generateBytesStream).toHaveBeenCalledWith({
        providerAddress: "0xsp",
        key: "test-key",
        bytesNeeded: 1024,
      });
    });

    it("returns gone when the registration TTL has passed", async () => {
      registryMock.resolve.mockResolvedValue({
        pieceCid: "bafk-test-piece",
        providerAddress: "0xsp",
        key: "test-key",
        size: 1024,
        expiresAt: new Date(Date.now() - 1_000),
      });

      const result = await service.openPullPieceStream("bafk-test-piece");
      expect(result?.status).toBe("gone");
      expect(dataSourceServiceMock.generateBytesStream).not.toHaveBeenCalled();
    });
  });
});
