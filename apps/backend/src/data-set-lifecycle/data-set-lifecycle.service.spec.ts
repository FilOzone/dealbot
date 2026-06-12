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
  terminateService: vi.fn(),
  waitForTerminateService: vi.fn(),
}));

const {
  createDataSet,
  waitForCreateDataSet,
  uploadPieceStreaming,
  findPiece,
  createDataSetAndAddPieces,
  waitForCreateDataSetAddPieces,
  terminateService,
  waitForTerminateService,
} = await import("@filoz/synapse-core/sp");

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
}

function setupTerminateMocks() {
  vi.mocked(terminateService).mockResolvedValue({ statusUrl: "https://sp.example.com/terminate/status" });
  vi.mocked(waitForTerminateService).mockResolvedValue({
    terminationTxHash: "0xterminate",
    txStatus: "confirmed",
    txSuccess: true,
    fwssTerminated: true,
    serviceTerminationEpoch: 100n,
  } as any);
}

function setupAllVariantMocks() {
  setupEmptyVariantMocks();
  setupWithPiecesVariantMocks();
  setupTerminateMocks();
}

describe("DataSetLifecycleService", () => {
  let service: DataSetLifecycleService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DataSetLifecycleService(mockWalletSdkService, mockMetrics);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Happy path: both variants run in parallel ─────────────────────────────

  it("runs both variants in parallel, records success for each, and resolves", async () => {
    setupAllVariantMocks();

    await service.runLifecycleCheck("0xsp", { dealbotLifecycleCheck: "nonce-123" });

    // empty variant
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

    // with-pieces variant
    expect(uploadPieceStreaming).toHaveBeenCalledWith(
      expect.objectContaining({ serviceURL: "https://sp.example.com" }),
    );
    expect(findPiece).toHaveBeenCalledWith(
      expect.objectContaining({ serviceURL: "https://sp.example.com", pieceCid: mockPieceCid, retry: true }),
    );
    expect(createDataSetAndAddPieces).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({
        cdn: false,
        payee: "0xpayee",
        serviceURL: "https://sp.example.com",
        pieces: [expect.objectContaining({ pieceCid: mockPieceCid })],
        metadata: { dealbotLifecycleCheck: "nonce-123" },
      }),
    );
    expect(waitForCreateDataSetAddPieces).toHaveBeenCalledWith(
      expect.objectContaining({ statusUrl: "https://sp.example.com/status/2" }),
    );

    // terminateService (provider-relayed) called for both data sets, each followed by a status poll
    expect(terminateService).toHaveBeenCalledTimes(2);
    expect(terminateService).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({ dataSetId: 42n, serviceURL: "https://sp.example.com" }),
    );
    expect(terminateService).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({ dataSetId: 77n, serviceURL: "https://sp.example.com" }),
    );
    expect(waitForTerminateService).toHaveBeenCalledTimes(2);
    expect(waitForTerminateService).toHaveBeenCalledWith(
      expect.objectContaining({ statusUrl: "https://sp.example.com/terminate/status" }),
    );

    expect(mockMetrics.recordStatus).toHaveBeenCalledOnce();
    expect(mockMetrics.recordStatus).toHaveBeenCalledWith(
      expect.objectContaining({ checkType: "dataSetLifecycleCheck" }),
      "success",
    );
    expect(mockMetrics.observeCheckDuration).toHaveBeenCalledOnce();
  });

  // ─── Abort before any work ─────────────────────────────────────────────────

  it("records failure.timedout for both variants when signal is aborted before any call", async () => {
    const controller = new AbortController();
    controller.abort(new Error("job timeout"));

    await expect(
      service.runLifecycleCheck("0xsp", { dealbotLifecycleCheck: "nonce-abort" }, controller.signal),
    ).rejects.toThrow();

    expect(createDataSet).not.toHaveBeenCalled();
    expect(uploadPieceStreaming).not.toHaveBeenCalled();
    expect(mockMetrics.recordStatus).toHaveBeenCalledOnce();
    expect(mockMetrics.recordStatus).toHaveBeenCalledWith(
      expect.objectContaining({ checkType: "dataSetLifecycleCheck" }),
      "failure.timedout",
    );
  });

  // ─── Dependency outages: partial failures are not swallowed ───────────────

  it("throws when empty variant fails even if with-pieces variant succeeds", async () => {
    setupWithPiecesVariantMocks();
    setupTerminateMocks();
    vi.mocked(createDataSet).mockRejectedValue(new Error("empty variant: SP unreachable"));

    await expect(service.runLifecycleCheck("0xsp", { dealbotLifecycleCheck: "nonce-partial-1" })).rejects.toThrow(
      "empty variant: SP unreachable",
    );

    expect(mockMetrics.recordStatus).toHaveBeenCalledOnce();
    expect(mockMetrics.recordStatus).toHaveBeenCalledWith(
      expect.objectContaining({ checkType: "dataSetLifecycleCheck" }),
      "failure.other",
    );
  });

  it("throws when with-pieces variant fails even if empty variant succeeds", async () => {
    setupEmptyVariantMocks();
    setupTerminateMocks();
    vi.mocked(uploadPieceStreaming).mockRejectedValue(new Error("with-pieces variant: upload failed"));

    await expect(service.runLifecycleCheck("0xsp", { dealbotLifecycleCheck: "nonce-partial-2" })).rejects.toThrow(
      "with-pieces variant: upload failed",
    );

    expect(mockMetrics.recordStatus).toHaveBeenCalledOnce();
    expect(mockMetrics.recordStatus).toHaveBeenCalledWith(
      expect.objectContaining({ checkType: "dataSetLifecycleCheck" }),
      "failure.other",
    );
  });

  it("throws AggregateError when both variants fail", async () => {
    vi.mocked(createDataSet).mockRejectedValue(new Error("empty failed"));
    vi.mocked(uploadPieceStreaming).mockRejectedValue(new Error("with-pieces failed"));

    const error = await service.runLifecycleCheck("0xsp", { dealbotLifecycleCheck: "nonce-both-fail" }).catch((e) => e);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toHaveLength(2);
    expect(mockMetrics.recordStatus).toHaveBeenCalledOnce();
    expect(mockMetrics.recordStatus).toHaveBeenCalledWith(
      expect.objectContaining({ checkType: "dataSetLifecycleCheck" }),
      "failure.other",
    );
  });

  // ─── Individual variant failure cases ─────────────────────────────────────

  it("records failure.other for empty variant when createDataSet rejects", async () => {
    setupWithPiecesVariantMocks();
    setupTerminateMocks();
    vi.mocked(createDataSet).mockRejectedValue(new Error("SP unreachable"));

    await expect(service.runLifecycleCheck("0xsp", { dealbotLifecycleCheck: "nonce-e-1" })).rejects.toThrow(
      "SP unreachable",
    );

    expect(terminateService).toHaveBeenCalledOnce(); // only with-pieces succeeded
    expect(mockMetrics.recordStatus).toHaveBeenCalledOnce();
    expect(mockMetrics.recordStatus).toHaveBeenCalledWith(
      expect.objectContaining({ checkType: "dataSetLifecycleCheck" }),
      "failure.other",
    );
  });

  it("records failure.other for empty variant when termination fails after creation", async () => {
    setupAllVariantMocks();
    vi.mocked(terminateService)
      .mockRejectedValueOnce(new Error("terminate failed"))
      .mockResolvedValueOnce({ statusUrl: "https://sp.example.com/terminate/status" });

    await expect(service.runLifecycleCheck("0xsp", { dealbotLifecycleCheck: "nonce-e-2" })).rejects.toThrow(
      "terminate failed",
    );

    expect(mockMetrics.recordStatus).toHaveBeenCalledOnce();
    expect(mockMetrics.recordStatus).toHaveBeenCalledWith(
      expect.objectContaining({ checkType: "dataSetLifecycleCheck" }),
      "failure.other",
    );
  });

  it("records failure.other for with-pieces variant when findPiece rejects", async () => {
    setupEmptyVariantMocks();
    setupTerminateMocks();
    vi.mocked(uploadPieceStreaming).mockResolvedValue({ pieceCid: mockPieceCid as any, size: 256 });
    vi.mocked(findPiece).mockRejectedValue(new Error("piece not found"));

    await expect(service.runLifecycleCheck("0xsp", { dealbotLifecycleCheck: "nonce-wp-1" })).rejects.toThrow(
      "piece not found",
    );

    expect(createDataSetAndAddPieces).not.toHaveBeenCalled();
    expect(mockMetrics.recordStatus).toHaveBeenCalledOnce();
    expect(mockMetrics.recordStatus).toHaveBeenCalledWith(
      expect.objectContaining({ checkType: "dataSetLifecycleCheck" }),
      "failure.other",
    );
  });

  it("records failure.other for with-pieces variant when createDataSetAndAddPieces rejects", async () => {
    setupEmptyVariantMocks();
    setupTerminateMocks();
    vi.mocked(uploadPieceStreaming).mockResolvedValue({ pieceCid: mockPieceCid as any, size: 256 });
    vi.mocked(findPiece).mockResolvedValue(mockPieceCid as any);
    vi.mocked(createDataSetAndAddPieces).mockRejectedValue(new Error("on-chain create failed"));

    await expect(service.runLifecycleCheck("0xsp", { dealbotLifecycleCheck: "nonce-wp-2" })).rejects.toThrow(
      "on-chain create failed",
    );

    expect(waitForCreateDataSetAddPieces).not.toHaveBeenCalled();
    expect(mockMetrics.recordStatus).toHaveBeenCalledOnce();
    expect(mockMetrics.recordStatus).toHaveBeenCalledWith(
      expect.objectContaining({ checkType: "dataSetLifecycleCheck" }),
      "failure.other",
    );
  });

  it("records failure.other for with-pieces variant when termination fails after creation", async () => {
    setupAllVariantMocks();
    vi.mocked(terminateService)
      .mockResolvedValueOnce({ statusUrl: "https://sp.example.com/terminate/status" })
      .mockRejectedValueOnce(new Error("terminate failed"));

    await expect(service.runLifecycleCheck("0xsp", { dealbotLifecycleCheck: "nonce-wp-3" })).rejects.toThrow(
      "terminate failed",
    );

    expect(mockMetrics.recordStatus).toHaveBeenCalledOnce();
    expect(mockMetrics.recordStatus).toHaveBeenCalledWith(
      expect.objectContaining({ checkType: "dataSetLifecycleCheck" }),
      "failure.other",
    );
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
