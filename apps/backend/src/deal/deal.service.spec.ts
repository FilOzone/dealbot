import { METADATA_KEYS, SIZE_CONSTANTS, Synapse } from "@filoz/synapse-sdk";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { executeUpload } from "filecoin-pin";
import { CID } from "multiformats/cid";
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { Deal } from "../database/entities/deal.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { DealStatus } from "../database/types.js";
import { DataSourceService } from "../dataSource/dataSource.service.js";
import { DealAddonsService } from "../deal-addons/deal-addons.service.js";
import { DealPreprocessingResult } from "../deal-addons/types.js";
import {
  DataSetCreationCheckMetrics,
  DataStorageCheckMetrics,
  RetrievalCheckMetrics,
} from "../metrics/utils/check-metrics.service.js";
import { RetrievalAddonsService } from "../retrieval-addons/retrieval-addons.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import type { PDPProviderEx } from "../wallet-sdk/wallet-sdk.types.js";
import { DealService } from "./deal.service.js";
import { privateKeyToAccount } from "viem/accounts";

vi.mock("@filoz/synapse-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@filoz/synapse-sdk")>();
  return {
    ...actual,
    RPC_URLS: {
      calibration: { http: "http://localhost:1234" },
    },
    Synapse: {
      create: vi.fn(),
    },
  };
});

vi.mock("filecoin-pin", () => ({
  executeUpload: vi.fn(),
  cleanupSynapseService: vi.fn(),
}));

describe("DealService", () => {
  let service: DealService;
  // We need access to the repository mocks to verify calls
  let dealRepoMock: typeof mockDealRepository;
  let dataSourceMock: typeof mockDataSourceService;
  let walletSdkMock: typeof mockWalletSdkService;
  let dealAddonsMock: typeof mockDealAddonsService;
  let retrievalAddonsMock: typeof mockRetrievalAddonsService;

  const mockRootCid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
  type UploadProgressEvent =
    | { type: "onStored"; data: { pieceCid: string } }
    | { type: "onPieceAdded"; data: { txHash: string } }
    | { type: "onPieceConfirmed"; data: { pieceIds: number[] } };
  type ExecuteUploadOptions = {
    onProgress?: (event: UploadProgressEvent) => Promise<void> | void;
  };
  const advanceTimersIfFake = (ms: number): void => {
    if (typeof vi.isFakeTimers === "function" && vi.isFakeTimers()) {
      vi.advanceTimersByTime(ms);
    }
  };
  const triggerUploadProgress = async (
    onProgress?: (event: UploadProgressEvent) => Promise<void> | void,
  ): Promise<void> => {
    if (!onProgress) {
      return;
    }

    await onProgress({ type: "onStored", data: { pieceCid: "bafk-uploaded" } });
    advanceTimersIfFake(2000);
    await onProgress({ type: "onPieceAdded", data: { txHash: "0xhash" } });
    advanceTimersIfFake(3000);
    await onProgress({ type: "onPieceConfirmed", data: { pieceIds: [123] } });
  };

  const mockDealRepository = {
    create: vi.fn(),
    save: vi.fn(),
    count: vi.fn(),
  };

  const mockStorageProviderRepository = {
    findOne: vi.fn(),
  };

  const mockDataSourceService = {
    generateRandomDataset: vi.fn(),
    cleanupRandomDataset: vi.fn(),
  };

  const mockConfigService = {
    get: vi.fn().mockImplementation((key: string) => {
      if (key === "scheduling") {
        return {
          dealIntervalSeconds: 30,
          dealStartOffsetSeconds: 0,
          retrievalIntervalSeconds: 60,
          retrievalStartOffsetSeconds: 600,
          metricsStartOffsetSeconds: 900,
        };
      }
      if (key === "blockchain") {
        return {
          walletPrivateKey: "mockKey",
          network: "calibration",
          walletAddress: "0x123",
          enableIpniTesting: "always",
        };
      }
      return undefined;
    }),
  };

  const mockWalletSdkService = {
    getFWSSAddress: vi.fn().mockReturnValue("0xFWSS"),
    getTestingProvidersCount: vi.fn(),
    getTestingProviders: vi.fn(),
    getProviderInfo: vi.fn().mockReturnValue(undefined),
  };

  const mockDealAddonsService = {
    preprocessDeal: vi.fn(),
    postProcessDeal: vi.fn(),
    handleUploadComplete: vi.fn(),
  };
  const mockRetrievalAddonsService = {
    testAllRetrievalMethods: vi.fn(),
  };
  const mockDataStorageMetrics = {
    observeIngestMs: vi.fn(),
    observeIngestThroughput: vi.fn(),
    observePieceAddedOnChainMs: vi.fn(),
    observePieceConfirmedOnChainMs: vi.fn(),
    observeCheckDuration: vi.fn(),
    recordUploadStatus: vi.fn(),
    recordOnchainStatus: vi.fn(),
    recordDataStorageStatus: vi.fn(),
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
  const mockDataSetCreationMetrics = {
    observeCheckDuration: vi.fn(),
    recordStatus: vi.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DealService,
        { provide: DataSourceService, useValue: mockDataSourceService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: WalletSdkService, useValue: mockWalletSdkService },
        { provide: DealAddonsService, useValue: mockDealAddonsService },
        { provide: RetrievalAddonsService, useValue: mockRetrievalAddonsService },
        { provide: getRepositoryToken(Deal), useValue: mockDealRepository },
        { provide: getRepositoryToken(StorageProvider), useValue: mockStorageProviderRepository },
        { provide: DataStorageCheckMetrics, useValue: mockDataStorageMetrics },
        { provide: RetrievalCheckMetrics, useValue: mockRetrievalMetrics },
        { provide: DataSetCreationCheckMetrics, useValue: mockDataSetCreationMetrics },
      ],
    }).compile();

    service = module.get<DealService>(DealService);

    // Assign mocks to variables for easier access in tests if needed,
    // though the consts above are also accessible.
    dealRepoMock = mockDealRepository;
    dataSourceMock = mockDataSourceService;
    walletSdkMock = mockWalletSdkService;
    dealAddonsMock = mockDealAddonsService;
    retrievalAddonsMock = mockRetrievalAddonsService;
    dealAddonsMock.handleUploadComplete.mockImplementation(async (deal: Deal) => {
      deal.ipniVerifiedAt = new Date();
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("createDeal", () => {
    let mockSynapseInstance: Synapse;
    let createContextMock: Mock;
    let mockProviderInfo: PDPProviderEx;
    let mockDealInput: DealPreprocessingResult;
    let mockDeal: Deal;

    beforeEach(async () => {
      // Setup common mocks for createDeal
      createContextMock = vi.fn();
      mockSynapseInstance = {
        storage: {
          createContext: createContextMock,
        },
      } as unknown as Synapse;

      mockProviderInfo = {
        id: 101n,
        serviceProvider: "0xProvider",
        payee: "0x100",
        name: "Test Provider",
        description: "Test Provider",
        isActive: true,
        isApproved: true,
        pdp: {
          serviceURL: 'todo',
          minPieceSizeInBytes: 0n,
          maxPieceSizeInBytes: 100n,
          storagePricePerTibPerDay: 1n,
          minProvingPeriodInEpochs: 1n,
          location: 'todo',
          paymentTokenAddress: '0xtodo',
          ipniPiece: true,
          ipniIpfs: true,
        },
      };
      mockDealInput = {
        processedData: { name: "test.txt", size: 2048, data: Buffer.from("test") },
        metadata: {},
        appliedAddons: [],
        synapseConfig: { dataSetMetadata: {}, pieceMetadata: {} },
      };
      mockDeal = Object.assign(new Deal(), {
        id: "deal-1",
        status: DealStatus.PENDING,
        spAddress: "0xProvider",
      });

      dealRepoMock.create.mockReturnValue(mockDeal);
      mockStorageProviderRepository.findOne.mockResolvedValue({});
    });

    it("processes the full deal lifecycle successfully", async () => {
      const uploadPayload = {
        carData: Uint8Array.from([1, 2, 3]),
        rootCid: CID.parse(mockRootCid),
      };

      createContextMock.mockResolvedValue({
        dataSetId: "dataset-123",
      });

      (executeUpload as Mock).mockImplementation(async (_service, _data, _rootCid, options) => {
        await triggerUploadProgress(options?.onProgress);
        return {
          pieceCid: "bafk-uploaded",
          pieceId: 123,
          transactionHash: "0xhash",
          ipniValidated: true,
        };
      });
      retrievalAddonsMock.testAllRetrievalMethods.mockResolvedValue({
        dealId: "deal-1",
        results: [],
        summary: { totalMethods: 1, successfulMethods: 1, failedMethods: 0 },
        testedAt: new Date(),
      });

      const deal = await service.createDeal(mockSynapseInstance, mockProviderInfo, mockDealInput, uploadPayload);

      expect(createContextMock).toHaveBeenCalledWith(expect.objectContaining({ providerAddress: "0xProvider" }));
      expect(dealRepoMock.create).toHaveBeenCalled();

      // Verify deal updates
      expect(deal.pieceCid).toBe("bafk-uploaded");
      expect(deal.status).toBe(DealStatus.DEAL_CREATED);
      expect(deal.transactionHash).toBe("0xhash");
      expect(deal.piecesConfirmedTime).toBeInstanceOf(Date);
      expect(deal.uploadStartTime).toBeInstanceOf(Date);

      expect(deal.dealLatencyMs).toBeGreaterThanOrEqual(0);
      expect(deal.dealLatencyWithIpniMs).toBeGreaterThanOrEqual(0);

      // Verify persistence
      expect(dealRepoMock.save).toHaveBeenCalledWith(deal);
      expect(dealAddonsMock.postProcessDeal).toHaveBeenCalledWith(
        deal,
        [],
        expect.objectContaining({
          dealId: deal.id,
          providerAddress: mockProviderInfo.serviceProvider,
          ipfsRootCID: uploadPayload.rootCid.toString(),
        }),
      );
    });

    it("emits data-storage metrics for successful deals", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

      try {
        const uploadPayload = {
          carData: Uint8Array.from([1, 2, 3]),
          rootCid: CID.parse(mockRootCid),
        };

        const providerInfo = { ...mockProviderInfo, isApproved: true };
        mockStorageProviderRepository.findOne.mockResolvedValue({
          providerId: 42,
          isApproved: true,
        });

        createContextMock.mockResolvedValue({
          dataSetId: "dataset-123",
        });

        (executeUpload as Mock).mockImplementation(async (_service, _data, _rootCid, options) => {
          vi.advanceTimersByTime(1500);
          await triggerUploadProgress(async (event) => {
            await options?.onProgress?.(event);
          });
          return {
            pieceCid: "bafk-uploaded",
            pieceId: 123,
            transactionHash: "0xhash",
            ipniValidated: true,
          };
        });

        retrievalAddonsMock.testAllRetrievalMethods.mockImplementation(async () => {
          vi.advanceTimersByTime(4000);
          return {
            dealId: "deal-1",
            results: [
              {
                url: "http://example.com",
                method: "direct",
                data: Buffer.alloc(0),
                metrics: {
                  latency: 500,
                  ttfb: 120,
                  throughput: 10_000,
                  statusCode: 200,
                  timestamp: new Date(),
                  responseSize: 0,
                },
                success: true,
              },
            ],
            summary: { totalMethods: 1, successfulMethods: 1, failedMethods: 0 },
            testedAt: new Date(),
          };
        });

        await service.createDeal(mockSynapseInstance, providerInfo, mockDealInput, uploadPayload);

        const labels = {
          checkType: "dataStorage",
          providerId: "42",
          providerStatus: "approved",
        };

        expect(mockDataStorageMetrics.recordUploadStatus).toHaveBeenCalledWith(labels, "pending");
        expect(mockDataStorageMetrics.recordUploadStatus).toHaveBeenCalledWith(labels, "success");
        expect(mockDataStorageMetrics.recordOnchainStatus).toHaveBeenCalledWith(labels, "pending");
        expect(mockDataStorageMetrics.recordOnchainStatus).toHaveBeenCalledWith(labels, "success");
        expect(mockDataStorageMetrics.recordDataStorageStatus).toHaveBeenCalledWith(labels, "pending");
        expect(mockDataStorageMetrics.recordDataStorageStatus).toHaveBeenCalledWith(labels, "success");
        expect(mockRetrievalMetrics.recordStatus).toHaveBeenCalledWith(labels, "pending");
        expect(mockRetrievalMetrics.recordStatus).toHaveBeenCalledWith(labels, "success");

        expect(mockDataStorageMetrics.observeIngestMs).toHaveBeenCalledWith(labels, 1500);
        expect(mockDataStorageMetrics.observePieceAddedOnChainMs).toHaveBeenCalledWith(labels, 2000);
        expect(mockDataStorageMetrics.observePieceConfirmedOnChainMs).toHaveBeenCalledWith(labels, 3000);
        expect(mockDataStorageMetrics.observeCheckDuration).toHaveBeenCalledWith(labels, 10_500);
        expect(mockRetrievalMetrics.recordResultMetrics).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ success: true, metrics: expect.objectContaining({ ttfb: 120 }) }),
          ]),
          labels,
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("records upload timeout status when upload fails", async () => {
      const uploadPayload = {
        carData: Uint8Array.from([1, 2, 3]),
        rootCid: CID.parse(mockRootCid),
      };
      const providerInfo = { ...mockProviderInfo, isApproved: false };
      mockStorageProviderRepository.findOne.mockResolvedValue({
        providerId: 7,
        isApproved: false,
      });
      createContextMock.mockResolvedValue({
        dataSetId: "dataset-123",
      });

      (executeUpload as Mock).mockRejectedValue(new Error("timed out waiting for upload"));

      await expect(service.createDeal(mockSynapseInstance, providerInfo, mockDealInput, uploadPayload)).rejects.toThrow(
        "timed out",
      );

      const labels = {
        checkType: "dataStorage",
        providerId: "7",
        providerStatus: "unapproved",
      };

      expect(mockDataStorageMetrics.recordUploadStatus).toHaveBeenCalledWith(labels, "pending");
      expect(mockDataStorageMetrics.recordUploadStatus).toHaveBeenCalledWith(labels, "failure.timedout");
      expect(mockDataStorageMetrics.recordOnchainStatus).not.toHaveBeenCalled();
      expect(mockDataStorageMetrics.recordDataStorageStatus).toHaveBeenCalledWith(labels, "pending");
      expect(mockDataStorageMetrics.recordDataStorageStatus).toHaveBeenCalledWith(labels, "failure.timedout");
    });

    it("records failure.other upload status when upload fails with non-timeout error", async () => {
      const uploadPayload = {
        carData: Uint8Array.from([1, 2, 3]),
        rootCid: CID.parse(mockRootCid),
      };
      const providerInfo = { ...mockProviderInfo, isApproved: false };
      mockStorageProviderRepository.findOne.mockResolvedValue({
        providerId: 7,
        isApproved: false,
      });
      createContextMock.mockResolvedValue({
        dataSetId: "dataset-123",
      });

      (executeUpload as Mock).mockRejectedValue(new Error("connection refused"));

      await expect(service.createDeal(mockSynapseInstance, providerInfo, mockDealInput, uploadPayload)).rejects.toThrow(
        "connection refused",
      );

      const labels = {
        checkType: "dataStorage",
        providerId: "7",
        providerStatus: "unapproved",
      };

      expect(mockDataStorageMetrics.recordUploadStatus).toHaveBeenCalledWith(labels, "pending");
      expect(mockDataStorageMetrics.recordUploadStatus).toHaveBeenCalledWith(labels, "failure.other");
      expect(mockDataStorageMetrics.recordDataStorageStatus).toHaveBeenCalledWith(labels, "pending");
      expect(mockDataStorageMetrics.recordDataStorageStatus).toHaveBeenCalledWith(labels, "failure.other");
    });

    it("handles upload failures correctly by marking deal as FAILED", async () => {
      const error = new Error("Upload failed");
      const uploadPayload = {
        carData: Uint8Array.from([1, 2, 3]),
        rootCid: CID.parse(mockRootCid),
      };

      createContextMock.mockResolvedValue({
        dataSetId: "dataset-123",
      });

      (executeUpload as Mock).mockRejectedValue(error);

      await expect(
        service.createDeal(mockSynapseInstance, mockProviderInfo, mockDealInput, uploadPayload),
      ).rejects.toThrow("Upload failed");

      expect(mockDeal.status).toBe(DealStatus.FAILED);
      expect(mockDeal.errorMessage).toBe("Upload failed");
      expect(dealRepoMock.save).toHaveBeenCalledWith(mockDeal);
    });

    it("handles storage creation failures", async () => {
      const error = new Error("Storage creation failed");
      const uploadPayload = {
        carData: Uint8Array.from([1, 2, 3]),
        rootCid: CID.parse(mockRootCid),
      };

      createContextMock.mockRejectedValue(error);

      await expect(
        service.createDeal(mockSynapseInstance, mockProviderInfo, mockDealInput, uploadPayload),
      ).rejects.toThrow("Storage creation failed");

      expect(mockDeal.status).toBe(DealStatus.FAILED);
      expect(mockDeal.errorMessage).toBe("Storage creation failed");
      expect(dealRepoMock.save).toHaveBeenCalledWith(mockDeal);
    });

    it("records abort reasons when signal aborts with a non-Error value", async () => {
      const uploadPayload = {
        carData: Uint8Array.from([1, 2, 3]),
        rootCid: CID.parse(mockRootCid),
      };
      const abortController = new AbortController();
      abortController.abort("abort-reason");

      await expect(
        service.createDeal(
          mockSynapseInstance,
          mockProviderInfo,
          mockDealInput,
          uploadPayload,
          undefined,
          abortController.signal,
        ),
      ).rejects.toBe("abort-reason");

      expect(mockDeal.status).toBe(DealStatus.FAILED);
      expect(mockDeal.errorMessage).toBe("abort-reason");
      expect(dealRepoMock.save).toHaveBeenCalledWith(mockDeal);
    });

    it("fails deal creation when upload completion handlers fail (IPNI gating)", async () => {
      const uploadPayload = {
        carData: Uint8Array.from([1, 2, 3]),
        rootCid: CID.parse(mockRootCid),
      };

      createContextMock.mockResolvedValue({
        dataSetId: "dataset-123",
      });

      (executeUpload as Mock).mockImplementation(async (_service, _data, _rootCid, options) => {
        await triggerUploadProgress(options?.onProgress);
        return {
          pieceCid: "bafk-uploaded",
          pieceId: 123,
          transactionHash: "0xhash",
          ipniValidated: true,
        };
      });

      const ipniError = new Error("IPNI verification failed");
      dealAddonsMock.handleUploadComplete.mockRejectedValueOnce(ipniError);

      await expect(
        service.createDeal(mockSynapseInstance, mockProviderInfo, mockDealInput, uploadPayload),
      ).rejects.toThrow("IPNI verification failed");

      expect(mockDeal.status).toBe(DealStatus.FAILED);
      expect(mockDeal.errorMessage).toBe("IPNI verification failed");
      expect(retrievalAddonsMock.testAllRetrievalMethods).not.toHaveBeenCalled();
    });

    it("fails deal creation when retrievals do not all succeed", async () => {
      const uploadPayload = {
        carData: Uint8Array.from([1, 2, 3]),
        rootCid: CID.parse(mockRootCid),
      };

      createContextMock.mockResolvedValue({
        dataSetId: "dataset-123",
      });

      (executeUpload as Mock).mockImplementation(async (_service, _data, _rootCid, options) => {
        await triggerUploadProgress(options?.onProgress);
        return {
          pieceCid: "bafk-uploaded",
          pieceId: 123,
          transactionHash: "0xhash",
          ipniValidated: true,
        };
      });

      retrievalAddonsMock.testAllRetrievalMethods.mockResolvedValue({
        dealId: "deal-1",
        results: [],
        summary: { totalMethods: 2, successfulMethods: 1, failedMethods: 1 },
        testedAt: new Date(),
      });

      await expect(
        service.createDeal(mockSynapseInstance, mockProviderInfo, mockDealInput, uploadPayload),
      ).rejects.toThrow("Retrieval gate failed");

      expect(mockDeal.status).toBe(DealStatus.FAILED);
      expect(mockDeal.errorMessage).toContain("Retrieval gate failed");
      expect(dealRepoMock.save).toHaveBeenCalledWith(mockDeal);
    });

    it("records onchain failure status when upload succeeds but onchain confirmation fails", async () => {
      const uploadPayload = {
        carData: Uint8Array.from([1, 2, 3]),
        rootCid: CID.parse(mockRootCid),
      };
      mockStorageProviderRepository.findOne.mockResolvedValue({
        providerId: 42,
        isApproved: true,
      });

      createContextMock.mockResolvedValue({
        dataSetId: "dataset-123",
      });

      // Upload fires onStored and onPieceAdded, but rejects before onPieceConfirmed
      (executeUpload as Mock).mockImplementation(
        async (_service: unknown, _data: unknown, _rootCid: unknown, options?: ExecuteUploadOptions) => {
          await options?.onProgress?.({ type: "onStored", data: { pieceCid: "bafk-uploaded" } });
          await options?.onProgress?.({ type: "onPieceAdded", data: { txHash: "0xhash" } });
          throw new Error("timed out waiting for piece confirmation");
        },
      );

      await expect(
        service.createDeal(mockSynapseInstance, mockProviderInfo, mockDealInput, uploadPayload),
      ).rejects.toThrow("timed out");

      const labels = {
        checkType: "dataStorage",
        providerId: "42",
        providerStatus: "approved",
      };

      // Upload should have succeeded
      expect(mockDataStorageMetrics.recordUploadStatus).toHaveBeenCalledWith(labels, "pending");
      expect(mockDataStorageMetrics.recordUploadStatus).toHaveBeenCalledWith(labels, "success");
      // Onchain should record pending then failure
      expect(mockDataStorageMetrics.recordOnchainStatus).toHaveBeenCalledWith(labels, "pending");
      expect(mockDataStorageMetrics.recordOnchainStatus).toHaveBeenCalledWith(labels, "failure.timedout");
      expect(mockDataStorageMetrics.recordDataStorageStatus).toHaveBeenCalledWith(labels, "pending");
      expect(mockDataStorageMetrics.recordDataStorageStatus).toHaveBeenCalledWith(labels, "failure.timedout");
      // Retrieval should not have been started
      expect(mockRetrievalMetrics.recordStatus).not.toHaveBeenCalled();
    });

    it("records retrieval failure status when upload+onchain succeed but retrieval fails", async () => {
      const uploadPayload = {
        carData: Uint8Array.from([1, 2, 3]),
        rootCid: CID.parse(mockRootCid),
      };
      mockStorageProviderRepository.findOne.mockResolvedValue({
        providerId: 42,
        isApproved: true,
      });

      createContextMock.mockResolvedValue({
        dataSetId: "dataset-123",
      });

      (executeUpload as Mock).mockImplementation(async (_service, _data, _rootCid, options) => {
        await triggerUploadProgress(options?.onProgress);
        return {
          pieceCid: "bafk-uploaded",
          pieceId: 123,
          transactionHash: "0xhash",
          ipniValidated: true,
        };
      });

      retrievalAddonsMock.testAllRetrievalMethods.mockRejectedValue(new Error("retrieval timed out"));

      await expect(
        service.createDeal(mockSynapseInstance, mockProviderInfo, mockDealInput, uploadPayload),
      ).rejects.toThrow("retrieval timed out");

      const labels = {
        checkType: "dataStorage",
        providerId: "42",
        providerStatus: "approved",
      };

      // Upload and onchain should have succeeded
      expect(mockDataStorageMetrics.recordUploadStatus).toHaveBeenCalledWith(labels, "success");
      expect(mockDataStorageMetrics.recordOnchainStatus).toHaveBeenCalledWith(labels, "success");
      expect(mockDataStorageMetrics.recordDataStorageStatus).toHaveBeenCalledWith(labels, "pending");
      expect(mockDataStorageMetrics.recordDataStorageStatus).toHaveBeenCalledWith(labels, "failure.timedout");
      // Retrieval should record pending then failure
      expect(mockRetrievalMetrics.recordStatus).toHaveBeenCalledWith(labels, "pending");
      expect(mockRetrievalMetrics.recordStatus).toHaveBeenCalledWith(labels, "failure.timedout");
    });

    it("sets dealLatencyMs even when IPNI verification is not enabled", async () => {
      dealAddonsMock.handleUploadComplete.mockResolvedValueOnce(undefined);

      const uploadPayload = {
        carData: Uint8Array.from([1, 2, 3]),
        rootCid: CID.parse(mockRootCid),
      };

      createContextMock.mockResolvedValue({
        dataSetId: "dataset-123",
      });

      (executeUpload as Mock).mockImplementation(async (_service, _data, _rootCid, options) => {
        await triggerUploadProgress(options?.onProgress);
        return {
          pieceCid: "bafk-uploaded",
          pieceId: 123,
          transactionHash: "0xhash",
          ipniValidated: true,
        };
      });
      retrievalAddonsMock.testAllRetrievalMethods.mockResolvedValue({
        dealId: "deal-1",
        results: [],
        summary: { totalMethods: 1, successfulMethods: 1, failedMethods: 0 },
        testedAt: new Date(),
      });

      const deal = await service.createDeal(mockSynapseInstance, mockProviderInfo, mockDealInput, uploadPayload);

      expect(deal.dealLatencyMs).toBeGreaterThanOrEqual(0);
      expect(deal.dealLatencyWithIpniMs).toBeUndefined();
    });

    describe("dataset versioning", () => {
      let dealInputWithMetadata: DealPreprocessingResult;

      beforeEach(() => {
        createContextMock.mockResolvedValue({
          dataSetId: "dataset-123",
        });

        (executeUpload as Mock).mockImplementation(async (_service, _data, _rootCid, options) => {
          await triggerUploadProgress(options?.onProgress);
          return {
            pieceCid: "bafk-uploaded",
            pieceId: 123,
            transactionHash: "0xhash",
            ipniValidated: true,
          };
        });
        mockRetrievalAddonsService.testAllRetrievalMethods.mockResolvedValue({
          dealId: "deal-1",
          results: [],
          summary: { totalMethods: 1, successfulMethods: 1, failedMethods: 0 },
          testedAt: new Date(),
        });

        dealInputWithMetadata = {
          ...mockDealInput,
          synapseConfig: {
            dataSetMetadata: { customKey: "customValue" },
            pieceMetadata: {},
          },
        };
      });

      const createServiceWithVersion = async (dealbotDataSetVersion: string | undefined) => {
        mockConfigService.get.mockReturnValue({
          walletPrivateKey: "0xMockKey",
          network: "calibration",
          walletAddress: "0x123",
          enableIpniTesting: "always",
          dealbotDataSetVersion,
        });

        const module: TestingModule = await Test.createTestingModule({
          providers: [
            DealService,
            { provide: DataSourceService, useValue: mockDataSourceService },
            { provide: ConfigService, useValue: mockConfigService },
            { provide: WalletSdkService, useValue: mockWalletSdkService },
            { provide: DealAddonsService, useValue: mockDealAddonsService },
            { provide: RetrievalAddonsService, useValue: mockRetrievalAddonsService },
            { provide: getRepositoryToken(Deal), useValue: mockDealRepository },
            { provide: getRepositoryToken(StorageProvider), useValue: mockStorageProviderRepository },
            { provide: DataStorageCheckMetrics, useValue: mockDataStorageMetrics },
            { provide: RetrievalCheckMetrics, useValue: mockRetrievalMetrics },
            { provide: DataSetCreationCheckMetrics, useValue: mockDataSetCreationMetrics },
          ],
        }).compile();

        const testService = module.get<DealService>(DealService);

        return testService;
      };

      it("includes version in metadata when DEALBOT_DATASET_VERSION is set", async () => {
        const testService = await createServiceWithVersion("dealbot-v2");
        const uploadPayload = {
          carData: Uint8Array.from([1, 2, 3]),
          rootCid: CID.parse(mockRootCid),
        };
        await testService.createDeal(mockSynapseInstance, mockProviderInfo, dealInputWithMetadata, uploadPayload);

        expect(createContextMock).toHaveBeenCalledWith({
          providerAddress: "0xProvider",
          metadata: {
            customKey: "customValue",
            dealbotDataSetVersion: "dealbot-v2",
          },
        });
      });

      it("does not include version in metadata when DEALBOT_DATASET_VERSION is undefined", async () => {
        const testService = await createServiceWithVersion(undefined);
        const uploadPayload = {
          carData: Uint8Array.from([1, 2, 3]),
          rootCid: CID.parse(mockRootCid),
        };
        await testService.createDeal(mockSynapseInstance, mockProviderInfo, dealInputWithMetadata, uploadPayload);

        expect(createContextMock).toHaveBeenCalledWith({
          providerAddress: "0xProvider",
          metadata: {
            customKey: "customValue",
          },
        });
      });

      it("does not include version in metadata when DEALBOT_DATASET_VERSION is empty string", async () => {
        const testService = await createServiceWithVersion("");
        const uploadPayload = {
          carData: Uint8Array.from([1, 2, 3]),
          rootCid: CID.parse(mockRootCid),
        };
        await testService.createDeal(mockSynapseInstance, mockProviderInfo, dealInputWithMetadata, uploadPayload);

        expect(createContextMock).toHaveBeenCalledWith({
          providerAddress: "0xProvider",
          metadata: {
            customKey: "customValue",
          },
        });
      });

      it("config dealbotDataSetVersion takes precedence over dealInput metadata", async () => {
        const testService = await createServiceWithVersion("dealbot-v3");
        const uploadPayload = {
          carData: Uint8Array.from([1, 2, 3]),
          rootCid: CID.parse(mockRootCid),
        };

        // Create dealInput with conflicting dealbotDataSetVersion ( not expected, but just in case )
        const dealInputWithConflict = {
          ...mockDealInput,
          synapseConfig: {
            dataSetMetadata: {
              customKey: "customValue",
              dealbotDataSetVersion: "old-version", // This should be overwritten
            },
            pieceMetadata: {},
          },
        };

        await testService.createDeal(mockSynapseInstance, mockProviderInfo, dealInputWithConflict, uploadPayload);

        // Verify config value overwrites dealInput value
        expect(createContextMock).toHaveBeenCalledWith({
          providerAddress: "0xProvider",
          metadata: {
            customKey: "customValue",
            dealbotDataSetVersion: "dealbot-v3", // Config value wins
          },
        });
      });
    });
  });

  describe("createDealsForAllProviders", () => {
    beforeEach(async () => {
      (Synapse.create as Mock).mockResolvedValue({});
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "scheduling") {
          return {
            dealIntervalSeconds: 30,
            dealStartOffsetSeconds: 0,
            retrievalIntervalSeconds: 60,
            retrievalStartOffsetSeconds: 600,
            metricsStartOffsetSeconds: 900,
          };
        }
        if (key === "blockchain") {
          return {
            walletPrivateKey: "mockKey",
            network: "calibration",
            walletAddress: "0x123",
            enableIpniTesting: "always",
          };
        }
        return undefined;
      });
    });

    it("orchestrates deal creation for multiple providers", async () => {
      const synapseInstance = {};
      (Synapse.create as Mock).mockResolvedValue(synapseInstance);
      const providers = [{ serviceProvider: "0x1" }, { serviceProvider: "0x2" }];
      const dataFile = { name: "test", size: 100, data: Buffer.from("test") };
      const preprocessed = {
        processedData: dataFile,
        metadata: {
          ipfs_pin: {
            enabled: true,
            rootCID: mockRootCid,
            blockCIDs: [],
            blockCount: 1,
            carSize: 1,
            originalSize: 1,
          },
        },
        appliedAddons: [],
        synapseConfig: {},
      };

      walletSdkMock.getTestingProvidersCount.mockReturnValue(2);
      walletSdkMock.getTestingProviders.mockReturnValue(providers);
      dataSourceMock.generateRandomDataset.mockResolvedValue(dataFile);
      dealAddonsMock.preprocessDeal.mockResolvedValue(preprocessed);

      // Mock createDeal to succeed
      const createDealSpy = vi.spyOn(service, "createDeal").mockResolvedValue({
        id: 1,
        status: DealStatus.DEAL_CREATED,
      } as unknown as Deal);

      const results = await service.createDealsForAllProviders();

      // Verify data fetching
      expect(dataSourceMock.generateRandomDataset).toHaveBeenCalledWith(
        SIZE_CONSTANTS.MIN_UPLOAD_SIZE,
        SIZE_CONSTANTS.MAX_UPLOAD_SIZE,
      );

      // Verify addon preprocessing
      expect(dealAddonsMock.preprocessDeal).toHaveBeenCalledWith(
        expect.objectContaining({
          dataFile,
          enableIpni: expect.any(Boolean),
        }),
        undefined,
      );

      // Verify parallelism/iteration
      expect(createDealSpy).toHaveBeenCalledTimes(2);
      expect(createDealSpy).toHaveBeenCalledWith(synapseInstance, providers[0], preprocessed, expect.any(Object));
      expect(createDealSpy).toHaveBeenCalledWith(synapseInstance, providers[1], preprocessed, expect.any(Object));

      expect(results).toHaveLength(2);
    });

    it("aggregates successful deals even if some fail", async () => {
      const providers = [{ serviceProvider: "0xSuccess" }, { serviceProvider: "0xFail" }];
      walletSdkMock.getTestingProviders.mockReturnValue(providers);
      walletSdkMock.getTestingProvidersCount.mockReturnValue(2);
      const dataFile = { name: "test", size: 100, data: Buffer.from("test") };
      dataSourceMock.generateRandomDataset.mockResolvedValue(dataFile);
      dealAddonsMock.preprocessDeal.mockResolvedValue({
        processedData: dataFile,
        metadata: {
          ipfs_pin: {
            enabled: true,
            rootCID: mockRootCid,
            blockCIDs: [],
            blockCount: 1,
            carSize: 1,
            originalSize: 1,
          },
        },
        appliedAddons: [],
        synapseConfig: {},
      });

      const createDealSpy = vi.spyOn(service, "createDeal");
      // First call succeeds
      createDealSpy.mockResolvedValueOnce({
        id: 1,
        spAddress: "0xSuccess",
      } as unknown as Deal);
      // Second call fails
      createDealSpy.mockRejectedValueOnce(new Error("Deal failed"));

      const results = await service.createDealsForAllProviders();

      expect(createDealSpy).toHaveBeenCalledTimes(2);
      // Should return only the successful one
      expect(results).toHaveLength(1);
      expect(results[0].spAddress).toBe("0xSuccess");
    });
  });

  describe("checkDataSetExists", () => {
    it("returns true when createContext returns a valid dataSetId", async () => {
      const synapseMock = {
        storage: {
          createContext: vi.fn().mockResolvedValue({ dataSetId: 1 }),
        },
      };

      vi.spyOn(service as any, "createSynapseInstance").mockResolvedValue(synapseMock as unknown as Synapse);

      const result = await service.checkDataSetExists("0xprovider", { dealbotDS: "1" });

      expect(result).toBe(true);
      expect(synapseMock.storage.createContext).toHaveBeenCalledWith({
        providerAddress: "0xprovider",
        metadata: { dealbotDS: "1" },
      });
    });

    it("returns false when createContext returns undefined dataSetId", async () => {
      const synapseMock = {
        storage: {
          createContext: vi.fn().mockResolvedValue({ dataSetId: undefined }),
        },
      };
      vi.spyOn(service as any, "createSynapseInstance").mockResolvedValue(synapseMock as unknown as Synapse);

      const result = await service.checkDataSetExists("0xprovider", { dealbotDS: "1" });

      expect(result).toBe(false);
    });
  });

  describe("getBaseDataSetMetadata", () => {
    it("includes IPNI metadata key when IPNI is enabled", () => {
      const metadata = service.getBaseDataSetMetadata(true);
      expect(metadata).toEqual({ [METADATA_KEYS.WITH_IPFS_INDEXING]: "" });
    });

    it("includes dataset version when configured", () => {
      (service as any).blockchainConfig.dealbotDataSetVersion = "v1";

      const metadata = service.getBaseDataSetMetadata(false);

      expect(metadata).toEqual({ dealbotDataSetVersion: "v1" });
    });
  });

  describe("createDataSetWithPiece", () => {
    const mockProviderInfo: PDPProviderEx = {
      id: 101n,
      serviceProvider: "0xprovider",
      payee: "0x100",
      name: "Test Provider",
      description: "Test Provider",
      isActive: true,
      isApproved: true,
      pdp: {
        serviceURL: 'todo',
        minPieceSizeInBytes: 0n,
        maxPieceSizeInBytes: 100n,
        storagePricePerTibPerDay: 1n,
        minProvingPeriodInEpochs: 1n,
        location: 'todo',
        paymentTokenAddress: '0xtodo',
        ipniPiece: true,
        ipniIpfs: true,
      },
    };

    it("throws when provider is not found in registry", async () => {
      vi.spyOn(mockWalletSdkService, "getProviderInfo").mockReturnValue(undefined);

      await expect(service.createDataSetWithPiece("0xunknown", { dealbotDS: "1" })).rejects.toThrow(
        "Provider 0xunknown not found in registry",
      );
    });

    it("creates dataset with piece via createContext + executeUpload", async () => {
      vi.spyOn(mockWalletSdkService, "getProviderInfo").mockReturnValue(mockProviderInfo);

      const createContextMock = vi.fn().mockResolvedValue({ dataSetId: 42 });
      const synapseMock = {
        storage: { createContext: createContextMock },
      } as unknown as Synapse;
      vi.spyOn(service as any, "createSynapseInstance").mockResolvedValue(synapseMock);

      (executeUpload as Mock).mockImplementation(async (_service, _data, _rootCid, options) => {
        await triggerUploadProgress(options?.onProgress);
        return { pieceCid: "bafk-seed", pieceId: 1, transactionHash: "0xhash" };
      });

      await service.createDataSetWithPiece("0xprovider", { dealbotDS: "1" });

      expect(createContextMock).toHaveBeenCalledWith({
        providerId: 101n,
        metadata: { dealbotDS: "1" },
      });
      expect(executeUpload).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Uint8Array),
        expect.any(Object),
        expect.objectContaining({
          pieceMetadata: {},
          ipniValidation: { enabled: false },
        }),
      );
      const carData = (executeUpload as Mock).mock.calls[0][1];
      expect(carData).toBeInstanceOf(Uint8Array);
      expect(carData.length).toBeGreaterThan(200 * 1024);
      expect(mockDataSetCreationMetrics.recordStatus).toHaveBeenCalledWith(
        expect.objectContaining({ checkType: "dataSetCreation" }),
        "pending",
      );
      expect(mockDataSetCreationMetrics.recordStatus).toHaveBeenCalledWith(
        expect.objectContaining({ checkType: "dataSetCreation" }),
        "success",
      );
    });

    it("does not invoke data-storage-check metrics or Deal persistence", async () => {
      vi.spyOn(mockWalletSdkService, "getProviderInfo").mockReturnValue(mockProviderInfo);
      const createContextMock = vi.fn().mockResolvedValue({ dataSetId: 1 });
      vi.spyOn(service as any, "createSynapseInstance").mockResolvedValue({
        storage: { createContext: createContextMock },
      } as unknown as Synapse);
      (executeUpload as Mock).mockImplementation(async (_s, _d, _r, opts) => {
        await triggerUploadProgress(opts?.onProgress);
        return { pieceCid: "bafk-seed" };
      });

      await service.createDataSetWithPiece("0xprovider", {});

      expect(mockDataStorageMetrics.observeIngestMs).not.toHaveBeenCalled();
      expect(mockDataStorageMetrics.recordUploadStatus).not.toHaveBeenCalled();
      expect(mockDataStorageMetrics.observePieceAddedOnChainMs).not.toHaveBeenCalled();
      expect(dealRepoMock.save).not.toHaveBeenCalled();
      expect(dataSourceMock.generateRandomDataset).not.toHaveBeenCalled();
    });

    it("fails when upload completes without a pieceCid", async () => {
      vi.spyOn(mockWalletSdkService, "getProviderInfo").mockReturnValue(mockProviderInfo);
      vi.spyOn(service as any, "createSynapseInstance").mockResolvedValue({
        storage: { createContext: vi.fn().mockResolvedValue({ dataSetId: 1 }) },
      } as unknown as Synapse);

      (executeUpload as Mock).mockResolvedValue({});

      await expect(service.createDataSetWithPiece("0xprovider", {})).rejects.toThrow(
        "Data-set creation upload completed without producing a pieceCid",
      );
      expect(mockDataSetCreationMetrics.recordStatus).not.toHaveBeenCalledWith(
        expect.objectContaining({ checkType: "dataSetCreation" }),
        "success",
      );
      expect(mockDataSetCreationMetrics.recordStatus).toHaveBeenCalledWith(
        expect.objectContaining({ checkType: "dataSetCreation" }),
        "failure.other",
      );
    });

    it("succeeds when upload finishes without both onPieceAdded and onPieceConfirmed", async () => {
      vi.spyOn(mockWalletSdkService, "getProviderInfo").mockReturnValue(mockProviderInfo);
      vi.spyOn(service as any, "createSynapseInstance").mockResolvedValue({
        storage: { createContext: vi.fn().mockResolvedValue({ dataSetId: 1 }) },
      } as unknown as Synapse);

      (executeUpload as Mock).mockImplementation(async (_s, _d, _r, opts) => {
        await opts?.onProgress?.({ type: "onStored", data: { pieceCid: "bafk" } });
      });

      await expect(service.createDataSetWithPiece("0xprovider", {})).resolves.toBeUndefined();
      expect(mockDataSetCreationMetrics.recordStatus).toHaveBeenCalledWith(
        expect.objectContaining({ checkType: "dataSetCreation" }),
        "success",
      );
    });

    it("aborts when signal is aborted during upload", async () => {
      vi.spyOn(mockWalletSdkService, "getProviderInfo").mockReturnValue(mockProviderInfo);
      vi.spyOn(service as any, "createSynapseInstance").mockResolvedValue({
        storage: { createContext: vi.fn().mockResolvedValue({ dataSetId: 1 }) },
      } as unknown as Synapse);

      (executeUpload as Mock).mockImplementation(async () => {
        await new Promise(() => {});
      });

      const controller = new AbortController();
      const resultPromise = service.createDataSetWithPiece("0xprovider", {}, controller.signal);
      controller.abort(new Error("Job aborted"));

      await expect(resultPromise).rejects.toThrow("Job aborted");
    });
  });
});
