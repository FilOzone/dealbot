import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataSetLifecycleCheckMetrics } from "../metrics-prometheus/check-metrics.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { DataSetLifecycleService } from "./data-set-lifecycle.service.js";

vi.mock("@filoz/synapse-core/sp", () => ({
  createDataSet: vi.fn(),
  waitForCreateDataSet: vi.fn(),
}));

vi.mock("@filoz/synapse-core/warm-storage", () => ({
  terminateServiceSync: vi.fn(),
}));

const { createDataSet, waitForCreateDataSet } = await import("@filoz/synapse-core/sp");
const { terminateServiceSync } = await import("@filoz/synapse-core/warm-storage");

const mockClient = { account: { address: "0xwallet" } };

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

describe("DataSetLifecycleService", () => {
  let service: DataSetLifecycleService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DataSetLifecycleService(mockWalletSdkService, mockMetrics);
  });

  it("creates an empty data set, waits for confirmation, terminates it, and records success", async () => {
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
    expect(mockMetrics.recordStatus).toHaveBeenCalledWith(expect.any(Object), "success");
  });

  it("records failure.timedout when signal is aborted before creation", async () => {
    const controller = new AbortController();
    controller.abort(new Error("job timeout"));

    await expect(
      service.runLifecycleCheck("0xsp", { dealbotLifecycleCheck: "nonce-456" }, controller.signal),
    ).rejects.toThrow();

    expect(createDataSet).not.toHaveBeenCalled();
    expect(mockMetrics.recordStatus).toHaveBeenCalledWith(expect.any(Object), "failure.timedout");
  });

  it("records failure.other when creation rejects with a non-abort error", async () => {
    vi.mocked(createDataSet).mockRejectedValue(new Error("SP unreachable"));

    await expect(service.runLifecycleCheck("0xsp", { dealbotLifecycleCheck: "nonce-789" })).rejects.toThrow(
      "SP unreachable",
    );

    expect(terminateServiceSync).not.toHaveBeenCalled();
    expect(mockMetrics.recordStatus).toHaveBeenCalledWith(expect.any(Object), "failure.other");
  });

  it("records failure.other when termination fails after creation, logging the dataSetId as leaked", async () => {
    vi.mocked(createDataSet).mockResolvedValue({ txHash: "0xhash2", statusUrl: "https://sp.example.com/status/2" });
    vi.mocked(waitForCreateDataSet).mockResolvedValue({
      dataSetId: 99n,
      dataSetCreated: true,
      txStatus: "confirmed",
      ok: true,
      createMessageHash: "0xmsg2",
      service: "https://sp.example.com",
    });
    vi.mocked(terminateServiceSync).mockRejectedValue(new Error("terminate failed"));

    await expect(service.runLifecycleCheck("0xsp", { dealbotLifecycleCheck: "nonce-999" })).rejects.toThrow(
      "terminate failed",
    );

    expect(mockMetrics.recordStatus).toHaveBeenCalledWith(expect.any(Object), "failure.other");
  });

  it("throws when provider is not found in registry", async () => {
    vi.mocked(mockWalletSdkService.getProviderInfo).mockReturnValueOnce(undefined);

    await expect(service.runLifecycleCheck("0xunknown", {})).rejects.toThrow("not found in registry");
  });

  it("throws when synapse client is not initialized", async () => {
    vi.mocked(mockWalletSdkService.getSynapseClient).mockReturnValueOnce(null);

    await expect(service.runLifecycleCheck("0xsp", {})).rejects.toThrow("not initialized");
  });
});
