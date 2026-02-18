import { waitForIpniProviderResults } from "filecoin-pin/core/utils";
import { CID } from "multiformats/cid";
import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";
import { Deal } from "../../database/entities/deal.entity.js";
import { StorageProvider } from "../../database/entities/storage-provider.entity.js";
import { IpniStatus, ServiceType } from "../../database/types.js";
import { buildCheckMetricLabels } from "../../metrics/utils/check-metric-labels.js";
import { DiscoverabilityCheckMetrics } from "../../metrics/utils/check-metrics.service.js";
import { IpniAddonStrategy } from "./ipni.strategy.js";

vi.mock("filecoin-pin/core/utils", () => ({
  waitForIpniProviderResults: vi.fn(),
}));

describe("IpniAddonStrategy getPieceStatus", () => {
  type DealForMetrics = {
    spAddress?: string;
    storageProvider?: {
      providerId?: number;
      isApproved?: boolean;
    } | null;
  } | null;
  type StrategyPrivates = {
    getPieceStatus: (serviceURL: string, pieceCid: string) => Promise<unknown>;
    monitorPieceStatus: (...args: unknown[]) => Promise<unknown>;
    monitorAndVerifyIPNI: (...args: unknown[]) => Promise<unknown>;
    updateDealWithIpniMetrics: (deal: Deal, result: unknown) => Promise<unknown>;
    startIpniMonitoring: (deal: Deal) => Promise<unknown>;
  };
  const asStrategyPrivates = (strategy: IpniAddonStrategy): StrategyPrivates => strategy as unknown as StrategyPrivates;
  const buildStorageProvider = (overrides: Partial<StorageProvider> = {}): StorageProvider =>
    Object.assign(new StorageProvider(), {
      address: "0xsp",
      providerId: 9,
      isApproved: true,
      serviceUrl: "http://sp.example.com",
      payee: "t0100",
      name: "SP",
      description: "SP",
      isActive: true,
      region: "test",
      metadata: {},
      ...overrides,
    });
  const buildDeal = (overrides: Partial<Deal> = {}): Deal =>
    Object.assign(new Deal(), {
      id: "deal-1",
      spAddress: "0xsp",
      fileName: "file",
      fileSize: 1,
      walletAddress: "0xwallet",
      metadata: {},
      ...overrides,
    });

  const createStrategy = () => {
    type HttpClientServiceMock = {
      requestWithMetrics: Mock;
    };
    const mockRepo = { save: vi.fn() } as unknown as ConstructorParameters<typeof IpniAddonStrategy>[0];
    const httpClientService: HttpClientServiceMock = {
      requestWithMetrics: vi.fn(),
    };
    const mockDiscoverabilityMetrics = {
      observeSpIndexLocallyMs: vi.fn(),
      observeSpAnnounceAdvertisementMs: vi.fn(),
      observeIpniVerifyMs: vi.fn(),
      recordStatus: vi.fn(),
      buildLabelsForDeal: vi.fn().mockImplementation((deal: DealForMetrics) => {
        if (!deal?.spAddress) return null;
        return buildCheckMetricLabels({
          checkType: "dataStorage",
          providerId: deal.storageProvider?.providerId,
          providerIsApproved: deal.storageProvider?.isApproved,
        });
      }),
    };

    return {
      strategy: new IpniAddonStrategy(
        mockRepo,
        httpClientService as unknown as ConstructorParameters<typeof IpniAddonStrategy>[1],
        mockDiscoverabilityMetrics as unknown as DiscoverabilityCheckMetrics,
      ),
      httpClientService,
      discoverabilityMetrics: mockDiscoverabilityMetrics,
      mockRepo,
    };
  };

  it("returns validated response data", async () => {
    const { strategy, httpClientService } = createStrategy();
    const payload = {
      pieceCid: "bafybeigdyrzt5p4y5pi7h3o5gq5wz2b2x2z2a2g2d2z2x2z2a2g2d",
      status: "indexed",
      indexed: true,
      advertised: false,
    };

    httpClientService.requestWithMetrics.mockResolvedValueOnce({
      data: Buffer.from(JSON.stringify(payload)),
    });

    const strategyForTest = asStrategyPrivates(strategy);

    await expect(strategyForTest.getPieceStatus("https://example.com", payload.pieceCid)).resolves.toEqual(payload);
  });

  it("throws on invalid response format", async () => {
    const { strategy, httpClientService } = createStrategy();

    httpClientService.requestWithMetrics.mockResolvedValueOnce({
      data: Buffer.from(JSON.stringify({ foo: "bar" })),
    });

    const strategyForTest = asStrategyPrivates(strategy);

    await expect(strategyForTest.getPieceStatus("https://example.com", "bafy-invalid")).rejects.toThrow(
      "Invalid piece status response format",
    );
  });

  it("throws a not-found error for 404 responses", async () => {
    const { strategy, httpClientService } = createStrategy();
    const error = {
      response: {
        status: 404,
        statusText: "Not Found",
        data: "missing",
      },
    };

    httpClientService.requestWithMetrics.mockRejectedValueOnce(error);

    const strategyForTest = asStrategyPrivates(strategy);

    await expect(strategyForTest.getPieceStatus("https://example.com", "bafy-404")).rejects.toThrow(
      "Piece not found or does not belong to service: missing",
    );
  });

  it("throws a detailed error for non-200 responses", async () => {
    const { strategy, httpClientService } = createStrategy();
    const error = {
      response: {
        status: 500,
        statusText: "Internal Server Error",
        data: "boom",
      },
    };

    httpClientService.requestWithMetrics.mockRejectedValueOnce(error);

    const strategyForTest = asStrategyPrivates(strategy);

    await expect(strategyForTest.getPieceStatus("https://example.com", "bafy-500")).rejects.toThrow(
      "Failed to get piece status: 500 Internal Server Error - boom",
    );
  });

  it("rethrows network errors", async () => {
    const { strategy, httpClientService } = createStrategy();

    httpClientService.requestWithMetrics.mockRejectedValueOnce(new Error("network down"));

    const strategyForTest = asStrategyPrivates(strategy);

    await expect(strategyForTest.getPieceStatus("https://example.com", "bafy-network")).rejects.toThrow("network down");
  });

  it("emits discoverability metrics when IPNI verification succeeds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    try {
      const { strategy, discoverabilityMetrics, mockRepo } = createStrategy();

      const uploadEndTime = new Date("2026-01-01T00:00:00Z");
      const indexedAt = new Date(uploadEndTime.getTime() + 1000).toISOString();
      const advertisedAt = new Date(uploadEndTime.getTime() + 2000).toISOString();

      const strategyForTest = asStrategyPrivates(strategy);
      vi.spyOn(strategyForTest, "monitorPieceStatus").mockResolvedValue({
        success: true,
        finalStatus: {
          status: "ok",
          indexed: true,
          advertised: true,
          indexedAt,
          advertisedAt,
        },
        checks: 1,
        durationMs: 2000,
      });

      vi.mocked(waitForIpniProviderResults).mockImplementation(async () => {
        vi.advanceTimersByTime(1500);
        return true;
      });

      const deal = buildDeal({
        id: "deal-1",
        spAddress: "0xsp",
        uploadEndTime,
        pieceCid: "bafk-piece",
        metadata: {
          [ServiceType.IPFS_PIN]: {
            enabled: true,
            rootCID: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
            blockCIDs: ["bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"],
            blockCount: 1,
            carSize: 1,
            originalSize: 1,
          },
        },
        storageProvider: buildStorageProvider(),
      });
      const ipniMetadata = deal.metadata[ServiceType.IPFS_PIN]!;

      const result = await strategyForTest.monitorAndVerifyIPNI(
        "http://sp.example.com",
        deal,
        [CID.parse(ipniMetadata.rootCID)],
        ipniMetadata.rootCID,
        deal.storageProvider,
        10_000,
        10_000,
        1000,
      );

      await strategyForTest.updateDealWithIpniMetrics(deal, result);

      const labels = {
        checkType: "dataStorage",
        providerId: "9",
        providerStatus: "approved",
      };

      expect(discoverabilityMetrics.observeSpIndexLocallyMs).toHaveBeenCalledWith(labels, 1000);
      expect(discoverabilityMetrics.observeSpAnnounceAdvertisementMs).toHaveBeenCalledWith(labels, 2000);
      expect(discoverabilityMetrics.observeIpniVerifyMs).toHaveBeenCalledWith(labels, 1500);
      expect(discoverabilityMetrics.recordStatus).toHaveBeenCalledWith(labels, "sp_indexed");
      expect(discoverabilityMetrics.recordStatus).toHaveBeenCalledWith(labels, "sp_announced_advertisement");
      expect(discoverabilityMetrics.recordStatus).toHaveBeenCalledWith(labels, "success");

      expect(mockRepo.save).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("records failure.timedout discoverability status when IPNI verification times out", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    try {
      const { strategy, discoverabilityMetrics, mockRepo } = createStrategy();

      const uploadEndTime = new Date("2026-01-01T00:00:00Z");

      const strategyForTest = asStrategyPrivates(strategy);
      vi.spyOn(strategyForTest, "monitorPieceStatus").mockResolvedValue({
        success: false,
        finalStatus: {
          status: "timeout",
          indexed: false,
          advertised: false,
          indexedAt: null,
          advertisedAt: null,
        },
        checks: 5,
        durationMs: 10_000,
      });

      vi.mocked(waitForIpniProviderResults).mockImplementation(async () => {
        vi.advanceTimersByTime(10_000);
        return false;
      });

      const deal = buildDeal({
        id: "deal-2",
        spAddress: "0xsp",
        uploadEndTime,
        pieceCid: "bafk-piece-timeout",
        metadata: {
          [ServiceType.IPFS_PIN]: {
            enabled: true,
            rootCID: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
            blockCIDs: ["bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"],
            blockCount: 1,
            carSize: 1,
            originalSize: 1,
          },
        },
        storageProvider: buildStorageProvider(),
      });
      const ipniMetadata = deal.metadata[ServiceType.IPFS_PIN]!;

      const result = await strategyForTest.monitorAndVerifyIPNI(
        "http://sp.example.com",
        deal,
        [CID.parse(ipniMetadata.rootCID)],
        ipniMetadata.rootCID,
        deal.storageProvider,
        10_000,
        10_000,
        1000,
      );

      await strategyForTest.updateDealWithIpniMetrics(deal, result);

      const labels = {
        checkType: "dataStorage",
        providerId: "9",
        providerStatus: "approved",
      };

      expect(discoverabilityMetrics.recordStatus).toHaveBeenCalledWith(labels, "failure.timedout");
      expect(mockRepo.save).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("emits failure status via startIpniMonitoring catch block when monitorAndVerifyIPNI throws", async () => {
    const { strategy, discoverabilityMetrics, mockRepo } = createStrategy();

    const deal = buildDeal({
      id: "deal-3",
      spAddress: "0xsp",
      uploadEndTime: new Date("2026-01-01T00:00:00Z"),
      pieceCid: "bafk-piece-error",
      ipniStatus: IpniStatus.PENDING,
      metadata: {
        [ServiceType.IPFS_PIN]: {
          enabled: true,
          rootCID: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
          blockCIDs: ["bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"],
          blockCount: 1,
          carSize: 1,
          originalSize: 1,
        },
      },
      storageProvider: buildStorageProvider(),
    });

    // monitorAndVerifyIPNI throws before updateDealWithIpniMetrics is called
    const strategyForTest = asStrategyPrivates(strategy);
    vi.spyOn(strategyForTest, "monitorAndVerifyIPNI").mockRejectedValue(new Error("connection timed out"));

    await expect(strategyForTest.startIpniMonitoring(deal)).rejects.toThrow("connection timed out");

    const labels = {
      checkType: "dataStorage",
      providerId: "9",
      providerStatus: "approved",
    };

    // Catch block should emit failure.timedout via classifyFailureStatus
    expect(discoverabilityMetrics.recordStatus).toHaveBeenCalledWith(labels, "failure.timedout");
    expect(mockRepo.save).toHaveBeenCalled();
  });

  it("emits failure.other via startIpniMonitoring catch block for non-timeout errors", async () => {
    const { strategy, discoverabilityMetrics, mockRepo } = createStrategy();

    const deal = buildDeal({
      id: "deal-4",
      spAddress: "0xsp",
      uploadEndTime: new Date("2026-01-01T00:00:00Z"),
      pieceCid: "bafk-piece-error2",
      ipniStatus: IpniStatus.PENDING,
      metadata: {
        [ServiceType.IPFS_PIN]: {
          enabled: true,
          rootCID: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
          blockCIDs: ["bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"],
          blockCount: 1,
          carSize: 1,
          originalSize: 1,
        },
      },
      storageProvider: buildStorageProvider(),
    });

    const strategyForTest = asStrategyPrivates(strategy);
    vi.spyOn(strategyForTest, "monitorAndVerifyIPNI").mockRejectedValue(new Error("unexpected error"));

    await expect(strategyForTest.startIpniMonitoring(deal)).rejects.toThrow("unexpected error");

    const labels = {
      checkType: "dataStorage",
      providerId: "9",
      providerStatus: "approved",
    };

    expect(discoverabilityMetrics.recordStatus).toHaveBeenCalledWith(labels, "failure.other");
    expect(mockRepo.save).toHaveBeenCalled();
  });
});
