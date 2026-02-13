import { SIZE_CONSTANTS, Synapse } from "@filoz/synapse-sdk";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { getToken } from "@willsoto/nestjs-prometheus";
import { executeUpload } from "filecoin-pin";
import { CID } from "multiformats/cid";
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { Deal } from "../database/entities/deal.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { DealStatus } from "../database/types.js";
import { DataSourceService } from "../dataSource/dataSource.service.js";
import { DealAddonsService } from "../deal-addons/deal-addons.service.js";
import { DealPreprocessingResult } from "../deal-addons/types.js";
import { RetrievalAddonsService } from "../retrieval-addons/retrieval-addons.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { DealService } from "./deal.service.js";

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
  let dealRepoMock: any;
  let dataSourceMock: any;
  let walletSdkMock: any;
  let dealAddonsMock: any;
  let retrievalAddonsMock: any;

  const mockRootCid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
  const triggerUploadProgress = async (onProgress?: (event: any) => Promise<void> | void): Promise<void> => {
    if (!onProgress) {
      return;
    }

    await onProgress({ type: "onUploadComplete", data: { pieceCid: "bafk-uploaded" } });
    await onProgress({ type: "onPieceAdded", data: { txHash: "0xhash" } });
    await onProgress({ type: "onPieceConfirmed", data: { pieceIds: [123] } });
  };

  const mockDealRepository = {
    create: vi.fn(),
    save: vi.fn(),
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
          dealMaxConcurrency: 2,
          retrievalMaxConcurrency: 5,
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
  };

  const mockDealAddonsService = {
    preprocessDeal: vi.fn(),
    postProcessDeal: vi.fn(),
    handleUploadComplete: vi.fn(),
  };
  const mockRetrievalAddonsService = {
    testAllRetrievalMethods: vi.fn(),
  };
  const mockDealsCreatedCounter = { inc: vi.fn() };
  const mockDealCreationDuration = { observe: vi.fn() };
  const mockDealUploadDuration = { observe: vi.fn() };
  const mockDealChainLatency = { observe: vi.fn() };

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
        { provide: getToken("deals_created_total"), useValue: mockDealsCreatedCounter },
        { provide: getToken("deal_creation_duration_seconds"), useValue: mockDealCreationDuration },
        { provide: getToken("deal_upload_duration_seconds"), useValue: mockDealUploadDuration },
        { provide: getToken("deal_chain_latency_seconds"), useValue: mockDealChainLatency },
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
    let mockSynapseInstance: any;
    let mockProviderInfo: any;
    let mockDealInput: any;
    let mockDeal: any;

    beforeEach(async () => {
      // Setup common mocks for createDeal
      mockSynapseInstance = {
        storage: {
          createContext: vi.fn(),
        },
      };

      mockProviderInfo = { serviceProvider: "0xProvider" };
      mockDealInput = {
        processedData: { name: "test.txt", size: 2048, data: Buffer.from("test") },
        metadata: { foo: "bar" },
        appliedAddons: [],
        synapseConfig: { dataSetMetadata: {}, pieceMetadata: {} },
      };
      mockDeal = { id: 1, status: DealStatus.PENDING, spAddress: "0xProvider" };

      dealRepoMock.create.mockReturnValue(mockDeal);
      mockStorageProviderRepository.findOne.mockResolvedValue({});
    });

    it("processes the full deal lifecycle successfully", async () => {
      const uploadPayload = {
        carData: Uint8Array.from([1, 2, 3]),
        rootCid: CID.parse(mockRootCid),
      };

      mockSynapseInstance.storage.createContext.mockResolvedValue({
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

      expect(mockSynapseInstance.storage.createContext).toHaveBeenCalledWith(
        expect.objectContaining({ providerAddress: "0xProvider" }),
      );
      expect(dealRepoMock.create).toHaveBeenCalled();

      // Verify deal updates
      expect(deal.pieceCid).toBe("bafk-uploaded");
      expect(deal.status).toBe(DealStatus.DEAL_CREATED);
      expect(deal.transactionHash).toBe("0xhash");
      expect(deal.pieceConfirmedTime).toBeInstanceOf(Date);
      expect(deal.uploadStartTime).toBeInstanceOf(Date);

      expect(deal.dealLatencyMs).toBeGreaterThanOrEqual(0);
      expect(deal.dealLatencyWithIpniMs).toBeGreaterThanOrEqual(0);

      // Verify persistence
      expect(dealRepoMock.save).toHaveBeenCalledWith(deal);
      expect(dealAddonsMock.postProcessDeal).toHaveBeenCalledWith(deal, []);
    });

    it("handles upload failures correctly by marking deal as FAILED", async () => {
      const error = new Error("Upload failed");
      const uploadPayload = {
        carData: Uint8Array.from([1, 2, 3]),
        rootCid: CID.parse(mockRootCid),
      };

      mockSynapseInstance.storage.createContext.mockResolvedValue({
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

      mockSynapseInstance.storage.createContext.mockRejectedValue(error);

      await expect(
        service.createDeal(mockSynapseInstance, mockProviderInfo, mockDealInput, uploadPayload),
      ).rejects.toThrow("Storage creation failed");

      expect(mockDeal.status).toBe(DealStatus.FAILED);
      expect(mockDeal.errorMessage).toBe("Storage creation failed");
      expect(dealRepoMock.save).toHaveBeenCalledWith(mockDeal);
    });

    it("fails deal creation when upload completion handlers fail (IPNI gating)", async () => {
      const uploadPayload = {
        carData: Uint8Array.from([1, 2, 3]),
        rootCid: CID.parse(mockRootCid),
      };

      mockSynapseInstance.storage.createContext.mockResolvedValue({
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

      mockSynapseInstance.storage.createContext.mockResolvedValue({
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

    it("sets dealLatencyMs even when IPNI verification is not enabled", async () => {
      dealAddonsMock.handleUploadComplete.mockResolvedValueOnce(undefined);

      const uploadPayload = {
        carData: Uint8Array.from([1, 2, 3]),
        rootCid: CID.parse(mockRootCid),
      };

      mockSynapseInstance.storage.createContext.mockResolvedValue({
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
        mockSynapseInstance.storage.createContext.mockResolvedValue({
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
          walletPrivateKey: "mockKey",
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
            { provide: getToken("deals_created_total"), useValue: mockDealsCreatedCounter },
            { provide: getToken("deal_creation_duration_seconds"), useValue: mockDealCreationDuration },
            { provide: getToken("deal_upload_duration_seconds"), useValue: mockDealUploadDuration },
            { provide: getToken("deal_chain_latency_seconds"), useValue: mockDealChainLatency },
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

        expect(mockSynapseInstance.storage.createContext).toHaveBeenCalledWith({
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

        expect(mockSynapseInstance.storage.createContext).toHaveBeenCalledWith({
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

        expect(mockSynapseInstance.storage.createContext).toHaveBeenCalledWith({
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
        expect(mockSynapseInstance.storage.createContext).toHaveBeenCalledWith({
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
            dealMaxConcurrency: 2,
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
      const createDealSpy = vi
        .spyOn(service, "createDeal")
        .mockResolvedValue({ id: 1, status: DealStatus.DEAL_CREATED } as unknown as Deal);

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
      createDealSpy.mockResolvedValueOnce({ id: 1, spAddress: "0xSuccess" } as unknown as Deal);
      // Second call fails
      createDealSpy.mockRejectedValueOnce(new Error("Deal failed"));

      const results = await service.createDealsForAllProviders();

      expect(createDealSpy).toHaveBeenCalledTimes(2);
      // Should return only the successful one
      expect(results).toHaveLength(1);
      expect(results[0].spAddress).toBe("0xSuccess");
    });
  });
});
