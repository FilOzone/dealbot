import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataSetLifecycleCheckMetrics } from "../metrics-prometheus/check-metrics.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { DataSetLifecycleService } from "./data-set-lifecycle.service.js";

vi.mock("@filoz/synapse-core/sp", () => ({
  createDataSet: vi.fn(),
  waitForCreateDataSet: vi.fn(),
  uploadPieceStreaming: vi.fn(),
  findPiece: vi.fn(),
  createDataSetAndAddPieces: vi.fn(),
  waitForCreateDataSetAddPieces: vi.fn(),
}));

vi.mock("@filoz/synapse-core/warm-storage", () => ({
  terminateServiceSync: vi.fn(),
}));

const {
  createDataSet,
  waitForCreateDataSet,
  uploadPieceStreaming,
  findPiece,
  createDataSetAndAddPieces,
  waitForCreateDataSetAddPieces,
} = await import("@filoz/synapse-core/sp");
const { terminateServiceSync } = await import("@filoz/synapse-core/warm-storage");

const mockClient = { account: { address: "0xwallet" } };

const mockPieceCid = { toString: () => "baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq" };

const mockProviderInfo = {
  id: 1n,
  name: "test-sp",
  isApproved: true,
  serviceProvider: "0xsp" as `0x${string}`,
  payee: "0xpayee" as `0x${string}`,
  pdp: { serviceURL: "https://sp.example.com" },
};

const mockWalletSdkService = {
  getProviderInfo: vi.fn(() => mockProviderInfo),
  getSynapseClient: vi.fn(() => mockClient),
} as unknown as WalletSdkService;

const mockMetrics = {
  observeCheckDuration: vi.fn(),
  recordStatus: vi.fn(),
} as unknown as DataSetLifecycleCheckMetrics;

// Helpers that set up the full happy-path mocks for each variant.
function setupEmptyVariantMocks() {
  vi.mocked(createDataSet).mockResolvedValue({ txHash: "0xhash1", statusUrl: "https://sp.example.com/status/1" });
  vi.mocked(waitForCreateDataSet).mockResolvedValue({
    dataSetId: 42n,
    dataSetCreated: true,
    txStatus: "confirmed",
    ok: true,
    createMessageHash: "0xmsg",
    service: "https://sp.example.com",
  });
  vi.mocked(terminateServiceSync).mockResolvedValue({ receipt: {} as any, event: {} as any });
}

function setupWithPiecesVariantMocks() {
  vi.mocked(uploadPieceStreaming).mockResolvedValue({ pieceCid: mockPieceCid as any, size: 256 });
  vi.mocked(findPiece).mockResolvedValue(mockPieceCid as any);
  vi.mocked(createDataSetAndAddPieces).mockResolvedValue({
    txHash: "0xhash2",
    statusUrl: "https://sp.example.com/status/2",
  });
  vi.mocked(waitForCreateDataSetAddPieces).mockResolvedValue({
    hash: "0xhash2",
    dataSetId: 77n,
    piecesIds: [1n],
  });
  vi.mocked(terminateServiceSync).mockResolvedValue({ receipt: {} as any, event: {} as any });
}

describe("DataSetLifecycleService", () => {
  let service: DataSetLifecycleService;
  let mathRandomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DataSetLifecycleService(mockWalletSdkService, mockMetrics);
    mathRandomSpy = vi.spyOn(Math, "random");
  });

  afterEach(() => {
    mathRandomSpy.mockRestore();
  });

  // ─── Empty variant ────────────────────────────────────────────────────────

  describe("empty variant (Math.random() < 0.5)", () => {
    beforeEach(() => {
      mathRandomSpy.mockReturnValue(0.3);
    });

    it("creates an empty data set, waits for confirmation, terminates it, and records success", async () => {
      setupEmptyVariantMocks();

      await service.runLifecycleCheck("0xsp", { dealbotLifecycleCheck: "nonce-123" });

      expect(createDataSet).toHaveBeenCalledWith(
        mockClient,
        expect.objectContaining({
          cdn: false,
          payee: "0xpayee",
          serviceURL: "https://sp.example.com",
          metadata: { dealbotLifecycleCheck: "nonce-123" },
        }),
      );
      expect(waitForCreateDataSet).toHaveBeenCalledWith(
        expect.objectContaining({ statusUrl: "https://sp.example.com/status/1" }),
      );
      expect(terminateServiceSync).toHaveBeenCalledWith(mockClient, expect.objectContaining({ dataSetId: 42n }));
      expect(mockMetrics.observeCheckDuration).toHaveBeenCalledOnce();
      expect(mockMetrics.recordStatus).toHaveBeenCalledWith(
        expect.objectContaining({ checkType: "dataSetLifecycleCheck" }),
        "success",
      );
      // with-pieces functions must not run
      expect(uploadPieceStreaming).not.toHaveBeenCalled();
    });

    it("records failure.timedout when signal is aborted before any call", async () => {
      const controller = new AbortController();
      controller.abort(new Error("job timeout"));

      await expect(
        service.runLifecycleCheck("0xsp", { dealbotLifecycleCheck: "nonce-456" }, controller.signal),
      ).rejects.toThrow();

      expect(createDataSet).not.toHaveBeenCalled();
      expect(mockMetrics.recordStatus).toHaveBeenCalledWith(
        expect.objectContaining({ checkType: "dataSetLifecycleCheck" }),
        "failure.timedout",
      );
    });

    it("records failure.other when createDataSet rejects", async () => {
      vi.mocked(createDataSet).mockRejectedValue(new Error("SP unreachable"));

      await expect(service.runLifecycleCheck("0xsp", { dealbotLifecycleCheck: "nonce-789" })).rejects.toThrow(
        "SP unreachable",
      );

      expect(terminateServiceSync).not.toHaveBeenCalled();
      expect(mockMetrics.recordStatus).toHaveBeenCalledWith(
        expect.objectContaining({ checkType: "dataSetLifecycleCheck" }),
        "failure.other",
      );
    });

    it("records failure.other when termination fails after creation, logging the dataSetId as leaked", async () => {
      setupEmptyVariantMocks();
      vi.mocked(terminateServiceSync).mockRejectedValue(new Error("terminate failed"));

      await expect(service.runLifecycleCheck("0xsp", { dealbotLifecycleCheck: "nonce-999" })).rejects.toThrow(
        "terminate failed",
      );

      expect(mockMetrics.recordStatus).toHaveBeenCalledWith(
        expect.objectContaining({ checkType: "dataSetLifecycleCheck" }),
        "failure.other",
      );
    });
  });

  // ─── With-pieces variant ──────────────────────────────────────────────────

  describe("with-pieces variant (Math.random() >= 0.5)", () => {
    beforeEach(() => {
      mathRandomSpy.mockReturnValue(0.7);
    });

    it("uploads piece, verifies with findPiece, creates data set, waits for confirmation, terminates, and records success", async () => {
      setupWithPiecesVariantMocks();

      await service.runLifecycleCheck("0xsp", { dealbotLifecycleCheck: "nonce-wp-1" });

      expect(uploadPieceStreaming).toHaveBeenCalledWith(
        expect.objectContaining({ serviceURL: "https://sp.example.com" }),
      );
      expect(findPiece).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceURL: "https://sp.example.com",
          pieceCid: mockPieceCid,
          retry: true,
        }),
      );
      expect(createDataSetAndAddPieces).toHaveBeenCalledWith(
        mockClient,
        expect.objectContaining({
          cdn: false,
          payee: "0xpayee",
          serviceURL: "https://sp.example.com",
          pieces: [expect.objectContaining({ pieceCid: mockPieceCid })],
          metadata: { dealbotLifecycleCheck: "nonce-wp-1" },
        }),
      );
      expect(waitForCreateDataSetAddPieces).toHaveBeenCalledWith(
        expect.objectContaining({ statusUrl: "https://sp.example.com/status/2" }),
      );
      expect(terminateServiceSync).toHaveBeenCalledWith(mockClient, expect.objectContaining({ dataSetId: 77n }));
      expect(mockMetrics.observeCheckDuration).toHaveBeenCalledOnce();
      expect(mockMetrics.recordStatus).toHaveBeenCalledWith(
        expect.objectContaining({ checkType: "dataSetWithPiecesLifecycleCheck" }),
        "success",
      );
      // empty-variant function must not run
      expect(createDataSet).not.toHaveBeenCalled();
    });

    it("records failure.timedout when signal is aborted before any call", async () => {
      const controller = new AbortController();
      controller.abort(new Error("job timeout"));

      await expect(
        service.runLifecycleCheck("0xsp", { dealbotLifecycleCheck: "nonce-wp-abort" }, controller.signal),
      ).rejects.toThrow();

      expect(uploadPieceStreaming).not.toHaveBeenCalled();
      expect(mockMetrics.recordStatus).toHaveBeenCalledWith(
        expect.objectContaining({ checkType: "dataSetWithPiecesLifecycleCheck" }),
        "failure.timedout",
      );
    });

    it("records failure.other when uploadPieceStreaming rejects", async () => {
      vi.mocked(uploadPieceStreaming).mockRejectedValue(new Error("upload failed"));

      await expect(service.runLifecycleCheck("0xsp", { dealbotLifecycleCheck: "nonce-wp-2" })).rejects.toThrow(
        "upload failed",
      );

      expect(findPiece).not.toHaveBeenCalled();
      expect(createDataSetAndAddPieces).not.toHaveBeenCalled();
      expect(terminateServiceSync).not.toHaveBeenCalled();
      expect(mockMetrics.recordStatus).toHaveBeenCalledWith(
        expect.objectContaining({ checkType: "dataSetWithPiecesLifecycleCheck" }),
        "failure.other",
      );
    });

    it("records failure.other when findPiece rejects", async () => {
      vi.mocked(uploadPieceStreaming).mockResolvedValue({ pieceCid: mockPieceCid as any, size: 256 });
      vi.mocked(findPiece).mockRejectedValue(new Error("piece not found"));

      await expect(service.runLifecycleCheck("0xsp", { dealbotLifecycleCheck: "nonce-wp-3" })).rejects.toThrow(
        "piece not found",
      );

      expect(createDataSetAndAddPieces).not.toHaveBeenCalled();
      expect(terminateServiceSync).not.toHaveBeenCalled();
      expect(mockMetrics.recordStatus).toHaveBeenCalledWith(
        expect.objectContaining({ checkType: "dataSetWithPiecesLifecycleCheck" }),
        "failure.other",
      );
    });

    it("records failure.other when createDataSetAndAddPieces rejects", async () => {
      vi.mocked(uploadPieceStreaming).mockResolvedValue({ pieceCid: mockPieceCid as any, size: 256 });
      vi.mocked(findPiece).mockResolvedValue(mockPieceCid as any);
      vi.mocked(createDataSetAndAddPieces).mockRejectedValue(new Error("on-chain create failed"));

      await expect(service.runLifecycleCheck("0xsp", { dealbotLifecycleCheck: "nonce-wp-4" })).rejects.toThrow(
        "on-chain create failed",
      );

      expect(waitForCreateDataSetAddPieces).not.toHaveBeenCalled();
      expect(terminateServiceSync).not.toHaveBeenCalled();
      expect(mockMetrics.recordStatus).toHaveBeenCalledWith(
        expect.objectContaining({ checkType: "dataSetWithPiecesLifecycleCheck" }),
        "failure.other",
      );
    });

    it("records failure.other when termination fails after creation, logging the dataSetId as leaked", async () => {
      setupWithPiecesVariantMocks();
      vi.mocked(terminateServiceSync).mockRejectedValue(new Error("terminate failed"));

      await expect(service.runLifecycleCheck("0xsp", { dealbotLifecycleCheck: "nonce-wp-5" })).rejects.toThrow(
        "terminate failed",
      );

      expect(mockMetrics.recordStatus).toHaveBeenCalledWith(
        expect.objectContaining({ checkType: "dataSetWithPiecesLifecycleCheck" }),
        "failure.other",
      );
    });
  });

  // ─── Shared pre-flight guards ─────────────────────────────────────────────

  it("throws when provider is not found in registry", async () => {
    vi.mocked(mockWalletSdkService.getProviderInfo).mockReturnValueOnce(undefined);

    await expect(service.runLifecycleCheck("0xunknown", {})).rejects.toThrow("not found in registry");
  });

  it("throws when synapse client is not initialized", async () => {
    vi.mocked(mockWalletSdkService.getSynapseClient).mockReturnValueOnce(null);

    await expect(service.runLifecycleCheck("0xsp", {})).rejects.toThrow("not initialized");
  });
});
