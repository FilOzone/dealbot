import type { Synapse } from "@filoz/synapse-sdk";
import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IConfig } from "../config/app.config.js";
import { DataSourceService } from "../dataSource/dataSource.service.js";
import { DealService } from "../deal/deal.service.js";
import { HttpClientService } from "../http-client/http-client.service.js";
import { PullCheckCheckMetrics } from "../metrics-prometheus/check-metrics.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import type { PDPProviderEx } from "../wallet-sdk/wallet-sdk.types.js";
import { HostedPieceRegistry } from "./hosted-piece.registry.js";
import { PullCheckService } from "./pull-check.service.js";

// `@filoz/synapse-core/piece` is mocked so that piece CIDs are deterministic
// strings rather than real CID objects, keeping the tests fast and isolated
// from the SDK's internal hashing.
vi.mock("@filoz/synapse-core/piece", () => ({
  parse: vi.fn((s: string) => ({ __parsed: s, toString: () => s })),
  calculate: vi.fn(() => ({ toString: () => "bafk-test-piece" })),
}));

vi.mock("@filoz/synapse-core/sp", () => ({
  pullPieces: vi.fn(),
  waitForPullPieces: vi.fn(),
}));

vi.mock("@filoz/synapse-core/warm-storage", () => ({
  getDataSet: vi.fn(),
}));

// `createSynapseFromConfig` is invoked from `onModuleInit`; the tests do not
// run module init, but the import must resolve.
vi.mock("../common/synapse-factory.js", () => ({
  createSynapseFromConfig: vi.fn(),
}));

import { calculate } from "@filoz/synapse-core/piece";
import { pullPieces, waitForPullPieces } from "@filoz/synapse-core/sp";
import { getDataSet } from "@filoz/synapse-core/warm-storage";

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
    generateRandomDataset: ReturnType<typeof vi.fn>;
    cleanupRandomDataset: ReturnType<typeof vi.fn>;
  };
  let registryMock: {
    register: ReturnType<typeof vi.fn>;
    resolveAny: ReturnType<typeof vi.fn>;
    resolveActive: ReturnType<typeof vi.fn>;
    markCleanedUp: ReturnType<typeof vi.fn>;
    markPullSubmitted: ReturnType<typeof vi.fn>;
    markFirstByte: ReturnType<typeof vi.fn>;
    forget: ReturnType<typeof vi.fn>;
  };
  let dealServiceMock: { getBaseDataSetMetadata: ReturnType<typeof vi.fn> };
  let httpClientServiceMock: { requestWithMetrics: ReturnType<typeof vi.fn> };
  let metricsMock: {
    observeRequestLatencyMs: ReturnType<typeof vi.fn>;
    observeCompletionLatencyMs: ReturnType<typeof vi.fn>;
    recordStatus: ReturnType<typeof vi.fn>;
    recordProviderStatus: ReturnType<typeof vi.fn>;
    observeFirstByteMs: ReturnType<typeof vi.fn>;
    observeThroughputBps: ReturnType<typeof vi.fn>;
  };
  let configValues: Partial<IConfig>;

  beforeEach(async () => {
    walletSdkServiceMock = {
      getProviderInfo: vi.fn().mockReturnValue(makeProvider()),
      getSynapseClient: vi.fn().mockReturnValue({}),
    };
    dataSourceServiceMock = {
      generateRandomDataset: vi.fn(),
      cleanupRandomDataset: vi.fn(),
    };
    registryMock = {
      register: vi.fn(),
      resolveAny: vi.fn().mockReturnValue(null),
      resolveActive: vi.fn().mockReturnValue(null),
      markCleanedUp: vi.fn(),
      markPullSubmitted: vi.fn(),
      markFirstByte: vi.fn(),
      forget: vi.fn(),
    };
    dealServiceMock = {
      getBaseDataSetMetadata: vi.fn().mockReturnValue({}),
    };
    httpClientServiceMock = {
      requestWithMetrics: vi.fn(),
    };
    metricsMock = {
      observeRequestLatencyMs: vi.fn(),
      observeCompletionLatencyMs: vi.fn(),
      recordStatus: vi.fn(),
      recordProviderStatus: vi.fn(),
      observeFirstByteMs: vi.fn(),
      observeThroughputBps: vi.fn(),
    };

    configValues = {
      app: { host: "localhost", port: 3000, apiPublicUrl: "https://dealbot.example" } as IConfig["app"],
      blockchain: { network: "calibration", walletAddress: "0xwallet" } as IConfig["blockchain"],
      jobs: {
        pullCheckJobTimeoutSeconds: 300,
        pullCheckPollIntervalSeconds: 5,
        pullCheckPieceSizeBytes: 1024,
        pullCheckHostedPieceTtlSeconds: 600,
      } as IConfig["jobs"],
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
        { provide: HostedPieceRegistry, useValue: registryMock },
        { provide: PullCheckCheckMetrics, useValue: metricsMock },
        { provide: DealService, useValue: dealServiceMock },
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

  describe("prepareHostedPiece", () => {
    it("generates a dataset, computes the piece CID, and registers the hosted piece", async () => {
      dataSourceServiceMock.generateRandomDataset.mockResolvedValue({
        name: "test.bin",
        data: Buffer.from("hello"),
        size: 5,
      });

      const prepared = await service.prepareHostedPiece();

      expect(dataSourceServiceMock.generateRandomDataset).toHaveBeenCalledWith(1024, 1024);
      expect(calculate).toHaveBeenCalledTimes(1);
      expect(prepared.registration.pieceCid).toBe("bafk-test-piece");
      expect(prepared.registration.fileName).toBe("test.bin");
      expect(prepared.registration.byteLength).toBe(5);
      expect(prepared.sourceUrl).toBe("https://dealbot.example/api/piece/bafk-test-piece");
      expect(registryMock.register).toHaveBeenCalledWith(prepared.registration);
    });

    it("falls back to host:port when apiPublicUrl is not configured", async () => {
      configValues.app = { host: "localhost", port: 3000 } as IConfig["app"];
      dataSourceServiceMock.generateRandomDataset.mockResolvedValue({
        name: "test.bin",
        data: Buffer.from("hello"),
        size: 5,
      });

      const prepared = await service.prepareHostedPiece();
      expect(prepared.sourceUrl).toBe("http://localhost:3000/api/piece/bafk-test-piece");
    });
  });

  describe("cleanupHostedPiece", () => {
    const baseEntry = {
      pieceCid: "bafk-test-piece",
      filePath: "/tmp/datasets/test.bin",
      fileName: "test.bin",
      byteLength: 5,
      contentType: "application/octet-stream",
      expiresAt: new Date(Date.now() + 60_000),
      cleanedUp: false,
    };

    it("marks the registration cleaned up and removes the file", async () => {
      registryMock.resolveAny.mockReturnValue({ ...baseEntry });

      await service.cleanupHostedPiece(baseEntry.pieceCid);

      expect(registryMock.markCleanedUp).toHaveBeenCalledWith(baseEntry.pieceCid);
      expect(dataSourceServiceMock.cleanupRandomDataset).toHaveBeenCalledWith(baseEntry.fileName);
      expect(registryMock.forget).toHaveBeenCalledWith(baseEntry.pieceCid);
    });

    it("skips file cleanup when the registration is already cleaned up", async () => {
      registryMock.resolveAny.mockReturnValue({ ...baseEntry, cleanedUp: true });

      await service.cleanupHostedPiece(baseEntry.pieceCid);

      expect(registryMock.markCleanedUp).not.toHaveBeenCalled();
      expect(dataSourceServiceMock.cleanupRandomDataset).not.toHaveBeenCalled();
      expect(registryMock.forget).toHaveBeenCalledWith(baseEntry.pieceCid);
    });

    it("forgets the entry even when no registration exists", async () => {
      registryMock.resolveAny.mockReturnValue(null);

      await service.cleanupHostedPiece("missing");

      expect(registryMock.markCleanedUp).not.toHaveBeenCalled();
      expect(dataSourceServiceMock.cleanupRandomDataset).not.toHaveBeenCalled();
      expect(registryMock.forget).toHaveBeenCalledWith("missing");
    });

    it("does not propagate cleanup errors so callers can rely on it in finally", async () => {
      registryMock.resolveAny.mockReturnValue({ ...baseEntry });
      dataSourceServiceMock.cleanupRandomDataset.mockRejectedValue(new Error("disk full"));

      await expect(service.cleanupHostedPiece(baseEntry.pieceCid)).resolves.toBeUndefined();
      expect(registryMock.forget).toHaveBeenCalledWith(baseEntry.pieceCid);
    });
  });

  describe("validateByDirectPieceFetch", () => {
    const provider = makeProvider();
    const logContext = { jobId: "job-1", providerAddress: "0xsp", providerId: 42n, providerName: "test-sp" };

    it("returns true when the recomputed CID matches", async () => {
      httpClientServiceMock.requestWithMetrics.mockResolvedValue({ data: Buffer.from("payload") });
      vi.mocked(calculate).mockReturnValueOnce({ toString: () => "bafk-test-piece" } as ReturnType<typeof calculate>);

      const ok = await service.validateByDirectPieceFetch(provider, "bafk-test-piece", logContext);
      expect(ok).toBe(true);
      expect(httpClientServiceMock.requestWithMetrics).toHaveBeenCalledWith(
        "https://sp.example/piece/bafk-test-piece",
        expect.any(Object),
      );
    });

    it("returns false when the recomputed CID does not match", async () => {
      httpClientServiceMock.requestWithMetrics.mockResolvedValue({ data: Buffer.from("payload") });
      vi.mocked(calculate).mockReturnValueOnce({ toString: () => "bafk-different" } as ReturnType<typeof calculate>);

      const ok = await service.validateByDirectPieceFetch(provider, "bafk-test-piece", logContext);
      expect(ok).toBe(false);
    });

    it("returns false on transport errors (caller branches on the boolean to record a domain failure)", async () => {
      httpClientServiceMock.requestWithMetrics.mockRejectedValue(new Error("ECONNRESET"));

      const ok = await service.validateByDirectPieceFetch(provider, "bafk-test-piece", logContext);
      expect(ok).toBe(false);
    });

    it("re-throws when the abort signal fires so cancellation is not masked as validation failure", async () => {
      const abort = new AbortController();
      httpClientServiceMock.requestWithMetrics.mockImplementation(async () => {
        abort.abort();
        throw new Error("aborted");
      });

      await expect(
        service.validateByDirectPieceFetch(provider, "bafk-test-piece", logContext, abort.signal),
      ).rejects.toThrow();
    });

    it("strips a trailing slash from the SP serviceURL when constructing the fetch URL", async () => {
      httpClientServiceMock.requestWithMetrics.mockResolvedValue({ data: Buffer.from("payload") });
      vi.mocked(calculate).mockReturnValueOnce({ toString: () => "bafk-test-piece" } as ReturnType<typeof calculate>);

      await service.validateByDirectPieceFetch(provider, "bafk-test-piece", logContext);
      expect(httpClientServiceMock.requestWithMetrics).toHaveBeenCalledWith(
        "https://sp.example/piece/bafk-test-piece",
        expect.any(Object),
      );
    });
  });

  describe("runPullCheck", () => {
    const logContext = { jobId: "job-1", providerAddress: "0xsp", providerId: 42n, providerName: "test-sp" };

    function arrangeHappyPath() {
      // Pre-stage a registration that prepareHostedPiece will install.
      const registration = {
        pieceCid: "bafk-test-piece",
        filePath: "/tmp/datasets/test.bin",
        fileName: "test.bin",
        byteLength: 1024,
        contentType: "application/octet-stream",
        expiresAt: new Date(Date.now() + 60_000),
        cleanedUp: false,
        pullSubmittedAt: new Date("2030-01-01T00:00:00Z"),
        firstByteAt: new Date("2030-01-01T00:00:00.250Z"),
      };
      dataSourceServiceMock.generateRandomDataset.mockResolvedValue({
        name: registration.fileName,
        data: Buffer.alloc(registration.byteLength),
        size: registration.byteLength,
      });
      // After cleanup the resolveAny call returns the entry; before that the
      // run reads it once to compute first-byte latency. Same shape suffices.
      registryMock.resolveAny.mockReturnValue(registration);

      // Mock the synapse storage context returned by `synapse.storage.createContext`.
      const commitResult = {
        dataSetId: 7n,
        pieceIds: [11n, 12n],
        txHash: "0xtx",
      };
      const storage = {
        dataSetId: 7n,
        commit: vi.fn().mockResolvedValue(commitResult),
      };
      const sharedSynapse = {
        storage: { createContext: vi.fn().mockResolvedValue(storage) },
      } as unknown as Synapse;
      // The service caches sharedSynapse in onModuleInit; emulate that here.
      (service as unknown as { sharedSynapse: Synapse }).sharedSynapse = sharedSynapse;

      vi.mocked(getDataSet).mockResolvedValue({ clientDataSetId: 99n } as unknown as Awaited<
        ReturnType<typeof getDataSet>
      >);
      vi.mocked(pullPieces).mockResolvedValue({ status: "pending" } as unknown as Awaited<
        ReturnType<typeof pullPieces>
      >);
      vi.mocked(waitForPullPieces).mockResolvedValue({
        status: "complete",
        pieces: [{ pieceCid: "bafk-test-piece", status: "complete" }],
      } as unknown as Awaited<ReturnType<typeof waitForPullPieces>>);

      // Direct-fetch validation succeeds.
      httpClientServiceMock.requestWithMetrics.mockResolvedValue({ data: Buffer.from("payload") });
      vi.mocked(calculate).mockReturnValue({ toString: () => "bafk-test-piece" } as ReturnType<typeof calculate>);

      return { registration, storage, commitResult };
    }

    it("runs the full lifecycle, observes all metrics, and records success", async () => {
      const { registration, storage } = arrangeHappyPath();

      await service.runPullCheck("0xsp", undefined, logContext);

      // Submit timestamp is stamped on the registration.
      expect(registryMock.markPullSubmitted).toHaveBeenCalledWith(registration.pieceCid, expect.any(Date));
      // Latency histograms observed at least once each.
      expect(metricsMock.observeRequestLatencyMs).toHaveBeenCalledTimes(1);
      expect(metricsMock.observeCompletionLatencyMs).toHaveBeenCalledTimes(1);
      // Terminal SP status recorded exactly once.
      expect(metricsMock.recordProviderStatus).toHaveBeenCalledTimes(1);
      expect(metricsMock.recordProviderStatus).toHaveBeenCalledWith(expect.any(Object), "complete");
      // Commit was invoked with no per-piece metadata.
      expect(storage.commit).toHaveBeenCalledWith({
        pieces: [{ pieceCid: expect.any(Object) }],
      });
      // First-byte and throughput observed since the registration carries
      // pullSubmittedAt + firstByteAt and the path completed.
      expect(metricsMock.observeFirstByteMs).toHaveBeenCalledTimes(1);
      const firstByteMs = metricsMock.observeFirstByteMs.mock.calls[0][1] as number;
      expect(firstByteMs).toBe(250);
      expect(metricsMock.observeThroughputBps).toHaveBeenCalledTimes(1);
      // Terminal aggregate status is success.
      expect(metricsMock.recordStatus).toHaveBeenCalledWith(expect.any(Object), "success");
      // Cleanup ran exactly once.
      expect(registryMock.markCleanedUp).toHaveBeenCalledWith(registration.pieceCid);
      expect(registryMock.forget).toHaveBeenCalledWith(registration.pieceCid);
    });

    it("does not observe firstByte when the SP never read from /api/piece (cached pull)", async () => {
      const { registration } = arrangeHappyPath();
      // Simulate a cached pull: SP never fetched from us.
      registryMock.resolveAny.mockReturnValue({ ...registration, firstByteAt: undefined });

      await service.runPullCheck("0xsp", undefined, logContext);

      expect(metricsMock.observeFirstByteMs).not.toHaveBeenCalled();
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
      // Cleanup still runs in the finally block.
      expect(registryMock.forget).toHaveBeenCalled();
    });

    it("classifies timeouts as failure.timedout", async () => {
      arrangeHappyPath();
      vi.mocked(waitForPullPieces).mockRejectedValue(new Error("polling timed out after 300s"));

      await expect(service.runPullCheck("0xsp", undefined, logContext)).rejects.toThrow();
      expect(metricsMock.recordStatus).toHaveBeenLastCalledWith(expect.any(Object), "failure.timedout");
    });

    it("re-throws and runs cleanup when the validation step fails", async () => {
      arrangeHappyPath();
      // Force validation mismatch by returning a different recomputed CID.
      vi.mocked(calculate)
        .mockReturnValueOnce({ toString: () => "bafk-test-piece" } as ReturnType<typeof calculate>) // prepareHostedPiece
        .mockReturnValueOnce({ toString: () => "bafk-mismatch" } as ReturnType<typeof calculate>); // validateByDirectPieceFetch

      await expect(service.runPullCheck("0xsp", undefined, logContext)).rejects.toThrow(/validation failed/);
      expect(metricsMock.recordStatus).toHaveBeenLastCalledWith(expect.any(Object), "failure.other");
      expect(registryMock.forget).toHaveBeenCalled();
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

  describe("openHostedPieceStream", () => {
    it("returns null when no active registration exists", () => {
      registryMock.resolveActive.mockReturnValue(null);
      expect(service.openHostedPieceStream("missing")).toBeNull();
    });
  });
});
