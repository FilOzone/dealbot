import { SIZE_CONSTANTS, Synapse } from "@filoz/synapse-sdk";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { Deal } from "../database/entities/deal.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { DealStatus } from "../database/types.js";
import { DataSourceService } from "../dataSource/dataSource.service.js";
import { DealAddonsService } from "../deal-addons/deal-addons.service.js";
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

describe("DealService", () => {
  let service: DealService;
  // We need access to the repository mocks to verify calls
  let dealRepoMock: any;
  let dataSourceMock: any;
  let walletSdkMock: any;
  let dealAddonsMock: any;

  const mockDealRepository = {
    create: vi.fn(),
    save: vi.fn(),
  };

  const mockStorageProviderRepository = {
    findOne: vi.fn(),
  };

  const mockDataSourceService = {
    fetchKaggleDataset: vi.fn(),
    fetchLocalDataset: vi.fn(),
    generateRandomDataset: vi.fn(),
    cleanupRandomDataset: vi.fn(),
  };

  const mockConfigService = {
    get: vi.fn().mockReturnValue({
      walletPrivateKey: "mockKey",
      network: "calibration",
      walletAddress: "0x123",
      enableCDNTesting: true,
      enableIpniTesting: true,
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DealService,
        { provide: DataSourceService, useValue: mockDataSourceService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: WalletSdkService, useValue: mockWalletSdkService },
        { provide: DealAddonsService, useValue: mockDealAddonsService },
        { provide: getRepositoryToken(Deal), useValue: mockDealRepository },
        { provide: getRepositoryToken(StorageProvider), useValue: mockStorageProviderRepository },
      ],
    }).compile();

    service = module.get<DealService>(DealService);

    // Assign mocks to variables for easier access in tests if needed,
    // though the consts above are also accessible.
    dealRepoMock = mockDealRepository;
    dataSourceMock = mockDataSourceService;
    walletSdkMock = mockWalletSdkService;
    dealAddonsMock = mockDealAddonsService;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("onModuleInit", () => {
    it("initializes synapse with correct config", async () => {
      (Synapse.create as Mock).mockResolvedValue({});
      await service.onModuleInit();
      expect(Synapse.create).toHaveBeenCalledWith({
        privateKey: "mockKey",
        rpcURL: "http://localhost:1234",
        warmStorageAddress: "0xFWSS",
      });
    });

    it("throws if synapse initialization fails", async () => {
      (Synapse.create as Mock).mockRejectedValue(new Error("Init failed"));
      await expect(service.onModuleInit()).rejects.toThrow("Init failed");
    });
  });

  describe("createDeal", () => {
    let mockSynapseInstance: any;
    let mockProviderInfo: any;
    let mockDealInput: any;
    let mockDeal: any;

    beforeEach(async () => {
      // Setup common mocks for createDeal
      mockSynapseInstance = {
        createStorage: vi.fn(),
      };
      (Synapse.create as Mock).mockResolvedValue(mockSynapseInstance);
      await service.onModuleInit();

      mockProviderInfo = { serviceProvider: "0xProvider" };
      mockDealInput = {
        processedData: { name: "test.txt", size: 2048, data: Buffer.from("test") },
        metadata: { foo: "bar" },
        appliedAddons: [],
        synapseConfig: { coolDownMs: 1 },
      };
      mockDeal = { id: 1, status: DealStatus.PENDING, spAddress: "0xProvider" };

      dealRepoMock.create.mockReturnValue(mockDeal);
      mockStorageProviderRepository.findOne.mockResolvedValue({});
    });

    it("processes the full deal lifecycle successfully", async () => {
      const uploadMock = vi.fn(async (_data, { onUploadComplete, onPieceAdded }) => {
        await onUploadComplete("bafk-uploaded");
        await onPieceAdded({ transactionHash: "0xhash" });
        return { pieceCid: "bafk-uploaded", size: 1024, pieceId: "piece-123" };
      });

      mockSynapseInstance.createStorage.mockResolvedValue({
        dataSetId: "dataset-123",
        upload: uploadMock,
      });

      const deal = await service.createDeal(mockProviderInfo, mockDealInput);

      expect(mockSynapseInstance.createStorage).toHaveBeenCalledWith(
        expect.objectContaining({ providerAddress: "0xProvider" }),
      );
      expect(dealRepoMock.create).toHaveBeenCalled();

      // Verify deal updates
      expect(deal.pieceCid).toBe("bafk-uploaded");
      expect(deal.status).toBe(DealStatus.DEAL_CREATED);
      expect(deal.transactionHash).toBe("0xhash");

      // Verify persistence
      expect(dealRepoMock.save).toHaveBeenCalledWith(deal);
      expect(dealAddonsMock.postProcessDeal).toHaveBeenCalledWith(deal, []);
    });

    it("handles upload failures correctly by marking deal as FAILED", async () => {
      const error = new Error("Upload failed");
      const uploadMock = vi.fn().mockRejectedValue(error);

      mockSynapseInstance.createStorage.mockResolvedValue({
        dataSetId: "dataset-123",
        upload: uploadMock,
      });

      await expect(service.createDeal(mockProviderInfo, mockDealInput)).rejects.toThrow("Upload failed");

      expect(mockDeal.status).toBe(DealStatus.FAILED);
      expect(mockDeal.errorMessage).toBe("Upload failed");
      expect(dealRepoMock.save).toHaveBeenCalledWith(mockDeal);
    });

    it("handles storage creation failures", async () => {
      const error = new Error("Storage creation failed");
      mockSynapseInstance.createStorage.mockRejectedValue(error);

      await expect(service.createDeal(mockProviderInfo, mockDealInput)).rejects.toThrow("Storage creation failed");

      expect(mockDeal.status).toBe(DealStatus.FAILED);
      expect(mockDeal.errorMessage).toBe("Storage creation failed");
      expect(dealRepoMock.save).toHaveBeenCalledWith(mockDeal);
    });
  });

  describe("createDealsForAllProviders", () => {
    beforeEach(async () => {
      // We need a synapse instance even if we mock createDeal,
      // because onModuleInit is called.
      (Synapse.create as Mock).mockResolvedValue({ createStorage: vi.fn() });
      await service.onModuleInit();
    });

    it("orchestrates deal creation for multiple providers", async () => {
      const providers = [{ serviceProvider: "0x1" }, { serviceProvider: "0x2" }];
      const dataFile = { name: "test", size: 100, data: Buffer.from("test") };
      const preprocessed = {
        processedData: dataFile,
        metadata: {},
        appliedAddons: [],
        synapseConfig: {},
      };

      walletSdkMock.getTestingProvidersCount.mockReturnValue(2);
      walletSdkMock.getTestingProviders.mockReturnValue(providers);
      dataSourceMock.fetchKaggleDataset.mockResolvedValue(dataFile);
      dealAddonsMock.preprocessDeal.mockResolvedValue(preprocessed);

      // Mock createDeal to succeed
      const createDealSpy = vi
        .spyOn(service, "createDeal")
        .mockResolvedValue({ id: 1, status: DealStatus.DEAL_CREATED } as unknown as Deal);

      const results = await service.createDealsForAllProviders();

      // Verify data fetching
      expect(dataSourceMock.fetchKaggleDataset).toHaveBeenCalledWith(
        SIZE_CONSTANTS.MIN_UPLOAD_SIZE,
        SIZE_CONSTANTS.MAX_UPLOAD_SIZE,
      );

      // Verify addon preprocessing
      expect(dealAddonsMock.preprocessDeal).toHaveBeenCalledWith(
        expect.objectContaining({
          dataFile,
          enableCDN: expect.any(Boolean),
          enableIpni: expect.any(Boolean),
        }),
      );

      // Verify parallelism/iteration
      expect(createDealSpy).toHaveBeenCalledTimes(2);
      expect(createDealSpy).toHaveBeenCalledWith(providers[0], preprocessed);
      expect(createDealSpy).toHaveBeenCalledWith(providers[1], preprocessed);

      expect(results).toHaveLength(2);
    });

    it("falls back to local dataset if Kaggle fetch fails", async () => {
      walletSdkMock.getTestingProvidersCount.mockReturnValue(0);
      walletSdkMock.getTestingProviders.mockReturnValue([]);

      dataSourceMock.fetchKaggleDataset.mockRejectedValue(new Error("Network Error"));
      dataSourceMock.fetchLocalDataset.mockResolvedValue({ name: "local" });
      dealAddonsMock.preprocessDeal.mockResolvedValue({});

      await service.createDealsForAllProviders();

      expect(dataSourceMock.fetchKaggleDataset).toHaveBeenCalled();
      expect(dataSourceMock.fetchLocalDataset).toHaveBeenCalledWith(
        SIZE_CONSTANTS.MIN_UPLOAD_SIZE,
        SIZE_CONSTANTS.MAX_UPLOAD_SIZE,
      );
    });

    it("aggregates successful deals even if some fail", async () => {
      const providers = [{ serviceProvider: "0xSuccess" }, { serviceProvider: "0xFail" }];
      walletSdkMock.getTestingProviders.mockReturnValue(providers);
      walletSdkMock.getTestingProvidersCount.mockReturnValue(2);
      dataSourceMock.fetchKaggleDataset.mockResolvedValue({});
      dealAddonsMock.preprocessDeal.mockResolvedValue({});

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
