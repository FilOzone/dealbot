import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { calculateActualStorage, listDataSets } from "filecoin-pin/core/data-set";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IConfig } from "../config/app.config.js";
import { Deal } from "../database/entities/deal.entity.js";
import { DealStatus } from "../database/types.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { PieceCleanupService } from "./piece-cleanup.service.js";

vi.mock("@filoz/synapse-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@filoz/synapse-sdk")>();
  return {
    ...actual,
    RPC_URLS: {
      calibration: { http: "http://localhost:1234" },
    },
    Synapse: {
      create: vi.fn().mockReturnValue({
        storage: {
          createContext: vi.fn().mockResolvedValue({
            deletePiece: vi.fn(),
          }),
        },
      }),
    },
  };
});

vi.mock("../common/synapse-factory.js", () => ({
  createSynapseFromConfig: vi.fn().mockResolvedValue({
    synapse: {
      storage: {
        createContext: vi.fn().mockResolvedValue({
          deletePiece: vi.fn(),
        }),
      },
    },
    isSessionKeyMode: false,
  }),
}));

vi.mock("filecoin-pin/core/data-set", () => ({
  listDataSets: vi.fn().mockResolvedValue([]),
  calculateActualStorage: vi.fn().mockResolvedValue({
    totalBytes: 0n,
    dataSetCount: 0,
    dataSetsProcessed: 0,
    pieceCount: 0,
    warnings: [],
  }),
}));

describe("PieceCleanupService", () => {
  let service: PieceCleanupService;
  let dealRepoMock: ReturnType<typeof createDealRepoMock>;
  let walletSdkMock: ReturnType<typeof createWalletSdkMock>;

  const MiB = 1024 * 1024;
  const THRESHOLD_BYTES = 100 * MiB; // 100 MiB for tests

  function createDealRepoMock() {
    return {
      find: vi.fn(),
      save: vi.fn(),
      createQueryBuilder: vi.fn(),
    };
  }

  function createWalletSdkMock() {
    return {
      getProviderInfo: vi.fn().mockReturnValue({ id: 9, name: "Test SP" }),
    };
  }

  const TARGET_BYTES = 80 * MiB; // 80 MiB low-water mark for tests

  function createConfigMock() {
    return {
      get: vi.fn((key: keyof IConfig) => {
        if (key === "pieceCleanup") {
          return {
            maxDatasetStorageSizeBytes: THRESHOLD_BYTES,
            targetDatasetStorageSizeBytes: TARGET_BYTES,
          };
        }
        if (key === "blockchain") {
          return {
            walletPrivateKey: "0x1234567890123456789012345678901234567890123456789012345678901234",
            network: "calibration",
            walletAddress: "0x123",
          };
        }
        return undefined;
      }),
    };
  }

  function makeDeal(overrides: Partial<Deal> = {}): Deal {
    const deal = new Deal();
    deal.id = overrides.id ?? `deal-${Math.random().toString(36).slice(2)}`;
    deal.spAddress = overrides.spAddress ?? "0xProvider";
    deal.status = overrides.status ?? DealStatus.DEAL_CREATED;
    deal.pieceId = Object.hasOwn(overrides, "pieceId") ? (overrides.pieceId as number) : 42;
    deal.dataSetId = Object.hasOwn(overrides, "dataSetId") ? (overrides.dataSetId as bigint) : 1n;
    deal.pieceCid = overrides.pieceCid ?? "bafk-piece";
    deal.pieceSize = overrides.pieceSize ?? 10 * MiB;
    deal.fileSize = overrides.fileSize ?? 10 * MiB;
    deal.cleanedUp = overrides.cleanedUp ?? false;
    deal.createdAt = overrides.createdAt ?? new Date("2024-01-01T00:00:00Z");
    deal.walletAddress = overrides.walletAddress ?? "0x123";
    deal.fileName = overrides.fileName ?? "test.bin";
    return deal;
  }

  function mockQueryBuilder(totalBytes: number) {
    const qb = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getRawOne: vi.fn().mockResolvedValue({ totalBytes: String(totalBytes) }),
    };
    dealRepoMock.createQueryBuilder.mockReturnValue(qb);
    return qb;
  }

  beforeEach(async () => {
    dealRepoMock = createDealRepoMock();
    walletSdkMock = createWalletSdkMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PieceCleanupService,
        { provide: ConfigService, useValue: createConfigMock() },
        { provide: getRepositoryToken(Deal), useValue: dealRepoMock },
        { provide: WalletSdkService, useValue: walletSdkMock },
      ],
    }).compile();

    service = module.get<PieceCleanupService>(PieceCleanupService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getStoredBytesForProvider", () => {
    it("returns total bytes from the query builder", async () => {
      mockQueryBuilder(50 * MiB);

      const result = await service.getStoredBytesForProvider("0xProvider");

      expect(result).toBe(50 * MiB);
      expect(dealRepoMock.createQueryBuilder).toHaveBeenCalledWith("deal");
    });

    it("returns 0 when no deals exist", async () => {
      mockQueryBuilder(0);

      const result = await service.getStoredBytesForProvider("0xProvider");

      expect(result).toBe(0);
    });

    it("returns 0 when query result is null", async () => {
      const qb = {
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue(null),
      };
      dealRepoMock.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getStoredBytesForProvider("0xProvider");

      expect(result).toBe(0);
    });
  });

  describe("getLiveStoredBytesForProvider", () => {
    it("returns when aborted while listing datasets", async () => {
      const abortController = new AbortController();
      vi.mocked(listDataSets).mockReturnValueOnce(new Promise(() => {}) as any);

      const result = service.getLiveStoredBytesForProvider("0xProvider", abortController.signal);
      abortController.abort(new Error("listing timed out"));

      await expect(result).rejects.toThrow("listing timed out");
      expect(calculateActualStorage).not.toHaveBeenCalled();
    });

    it("passes the abort signal through to actual storage calculation", async () => {
      const signal = new AbortController().signal;
      vi.mocked(listDataSets).mockResolvedValueOnce([
        {
          dataSetId: 1n,
          providerId: 9,
          serviceProvider: "0xProvider",
          payee: "0xProvider",
          payer: "0x123",
          commissionBps: 0n,
          pdpRailId: 1n,
          cacheMissRailId: 0n,
          cdnRailId: 0n,
          withCDN: false,
          isLive: true,
          pdpEndEpoch: 0n,
          metadata: {},
        },
      ] as any);

      await service.getLiveStoredBytesForProvider("0xProvider", signal);

      expect(calculateActualStorage).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Array),
        expect.objectContaining({ signal }),
      );
    });

    it("throws when actual storage calculation times out", async () => {
      vi.mocked(listDataSets).mockResolvedValueOnce([
        {
          dataSetId: 1n,
          providerId: 9,
          serviceProvider: "0xProvider",
          payee: "0xProvider",
          payer: "0x123",
          commissionBps: 0n,
          pdpRailId: 1n,
          cacheMissRailId: 0n,
          cdnRailId: 0n,
          withCDN: false,
          isLive: true,
          pdpEndEpoch: 0n,
          metadata: {},
        },
      ] as any);
      vi.mocked(calculateActualStorage).mockResolvedValueOnce({
        totalBytes: 10n,
        dataSetCount: 1,
        dataSetsProcessed: 0,
        pieceCount: 0,
        warnings: [],
        timedOut: true,
      });

      await expect(service.getLiveStoredBytesForProvider("0xProvider")).rejects.toThrow("Live storage query timed out");
    });
  });

  describe("getCleanupCandidates", () => {
    it("queries for oldest completed deals with piece IDs", async () => {
      const deals = [makeDeal({ createdAt: new Date("2024-01-01") }), makeDeal({ createdAt: new Date("2024-01-02") })];
      dealRepoMock.find.mockResolvedValue(deals);

      const result = await service.getCleanupCandidates("0xProvider", 10);

      expect(result).toEqual(deals);
      expect(dealRepoMock.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            spAddress: "0xProvider",
            status: DealStatus.DEAL_CREATED,
            cleanedUp: false,
          }),
          order: { createdAt: "ASC" },
          take: 10,
        }),
      );
    });

    it("respects the limit parameter", async () => {
      dealRepoMock.find.mockResolvedValue([]);

      await service.getCleanupCandidates("0xProvider", 5);

      expect(dealRepoMock.find).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 5,
        }),
      );
    });
  });

  describe("cleanupPiecesForProvider", () => {
    it("skips cleanup when stored bytes are below threshold", async () => {
      vi.spyOn(service, "getLiveStoredBytesForProvider").mockResolvedValue(50 * MiB); // 50 MiB < 100 MiB threshold

      const result = await service.cleanupPiecesForProvider("0xProvider");

      expect(result.skipped).toBe(true);
      expect(result.deleted).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.storedBytes).toBe(50 * MiB);
      expect(result.thresholdBytes).toBe(THRESHOLD_BYTES);
    });

    it("skips cleanup when stored bytes equal threshold", async () => {
      vi.spyOn(service, "getLiveStoredBytesForProvider").mockResolvedValue(THRESHOLD_BYTES); // exactly at threshold

      const result = await service.cleanupPiecesForProvider("0xProvider");

      expect(result.skipped).toBe(true);
      expect(result.deleted).toBe(0);
    });

    it("does not select deletion candidates when the live quota query fails", async () => {
      vi.spyOn(service, "getLiveStoredBytesForProvider").mockRejectedValue(new Error("network error"));
      mockQueryBuilder(THRESHOLD_BYTES + 1);

      await expect(service.cleanupPiecesForProvider("0xProvider")).rejects.toThrow("network error");

      expect(dealRepoMock.find).not.toHaveBeenCalled();
      expect(dealRepoMock.createQueryBuilder).not.toHaveBeenCalled();
    });

    it("returns cleanup result with no candidates when above threshold but no eligible deals", async () => {
      vi.spyOn(service, "getLiveStoredBytesForProvider").mockResolvedValue(200 * MiB); // above threshold
      dealRepoMock.find.mockResolvedValue([]); // no candidates

      const result = await service.cleanupPiecesForProvider("0xProvider");

      expect(result.skipped).toBe(false);
      expect(result.deleted).toBe(0);
      expect(result.failed).toBe(0);
    });

    it("deletes pieces until excess is cleared (down to low-water mark)", async () => {
      // storedBytes = 130 MiB, target = 80 MiB, so excess = 50 MiB to delete
      vi.spyOn(service, "getLiveStoredBytesForProvider").mockResolvedValue(130 * MiB);

      const deal1 = makeDeal({ id: "deal-1", pieceId: 1, pieceSize: 10 * MiB });
      const deal2 = makeDeal({ id: "deal-2", pieceId: 2, pieceSize: 10 * MiB });
      const deal3 = makeDeal({ id: "deal-3", pieceId: 3, pieceSize: 10 * MiB });
      const deal4 = makeDeal({ id: "deal-4", pieceId: 4, pieceSize: 10 * MiB });
      const deal5 = makeDeal({ id: "deal-5", pieceId: 5, pieceSize: 10 * MiB });
      const deal6 = makeDeal({ id: "deal-6", pieceId: 6, pieceSize: 10 * MiB });
      dealRepoMock.find.mockResolvedValue([deal1, deal2, deal3, deal4, deal5, deal6]);

      const deletePieceSpy = vi.spyOn(service, "deletePiece").mockResolvedValue(undefined);

      const result = await service.cleanupPiecesForProvider("0xProvider");

      expect(result.deleted).toBe(5); // 50 MiB = 5 × 10 MiB
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(false);
      expect(deletePieceSpy).toHaveBeenCalledTimes(5);
    });

    it("continues deleting after individual piece failure", async () => {
      vi.spyOn(service, "getLiveStoredBytesForProvider").mockResolvedValue(200 * MiB);

      const deal1 = makeDeal({ id: "deal-1", pieceId: 1, pieceSize: 10 * MiB });
      const deal2 = makeDeal({ id: "deal-2", pieceId: 2, pieceSize: 10 * MiB });
      // First batch returns both deals; second batch returns empty
      dealRepoMock.find.mockResolvedValueOnce([deal1, deal2]).mockResolvedValueOnce([]);

      vi.spyOn(service, "deletePiece").mockRejectedValueOnce(new Error("SDK error")).mockResolvedValueOnce(undefined);

      const result = await service.cleanupPiecesForProvider("0xProvider");

      expect(result.deleted).toBe(1);
      expect(result.failed).toBe(1);
    });

    it("respects abort signal", async () => {
      vi.spyOn(service, "getLiveStoredBytesForProvider").mockResolvedValue(200 * MiB);

      const deal1 = makeDeal({ id: "deal-1", pieceId: 1, pieceSize: 10 * MiB });
      dealRepoMock.find.mockResolvedValue([deal1]);

      const abortController = new AbortController();
      abortController.abort(new Error("aborted"));

      await expect(service.cleanupPiecesForProvider("0xProvider", abortController.signal)).rejects.toThrow("aborted");
    });

    it("bails out when all deletions in a batch fail", async () => {
      vi.spyOn(service, "getLiveStoredBytesForProvider").mockResolvedValue(200 * MiB);

      const deal1 = makeDeal({ id: "deal-1", pieceId: 1, pieceSize: 10 * MiB });
      const deal2 = makeDeal({ id: "deal-2", pieceId: 2, pieceSize: 10 * MiB });
      dealRepoMock.find.mockResolvedValue([deal1, deal2]);

      vi.spyOn(service, "deletePiece").mockRejectedValue(new Error("persistent failure"));

      const result = await service.cleanupPiecesForProvider("0xProvider");

      expect(result.deleted).toBe(0);
      expect(result.failed).toBe(2);
      expect(result.skipped).toBe(false);
    });

    it("credits 0 bytes and bails out when pieceSize is 0", async () => {
      // storedBytes = 110 MiB, target = 80 MiB, excess = 30 MiB to delete
      vi.spyOn(service, "getLiveStoredBytesForProvider").mockResolvedValue(THRESHOLD_BYTES + 10 * MiB);

      const deal1 = makeDeal({ id: "deal-1", pieceId: 1, pieceSize: 0, fileSize: 10 * MiB });
      // First batch returns the deal, second batch returns []
      dealRepoMock.find.mockResolvedValueOnce([deal1]).mockResolvedValueOnce([]);

      const deletePieceSpy = vi.spyOn(service, "deletePiece").mockResolvedValue(undefined);

      const result = await service.cleanupPiecesForProvider("0xProvider");

      // Piece is still deleted
      expect(result.deleted).toBe(1);
      expect(deletePieceSpy).toHaveBeenCalledTimes(1);
      // pieceSize=0 credits 0 bytes, so the loop fetches a second batch to confirm no more candidates
      expect(dealRepoMock.find).toHaveBeenCalledTimes(2);
    });

    it("loops through multiple batches when excess spans batches", async () => {
      // storedBytes = 100 MiB + 20 MiB = 120 MiB, target = 80 MiB, excess = 40 MiB to delete
      vi.spyOn(service, "getLiveStoredBytesForProvider").mockResolvedValue(120 * MiB);

      // First batch returns 1 deal (10 MiB freed, still 30 MiB excess)
      const deal1 = makeDeal({ id: "deal-1", pieceId: 1, pieceSize: 10 * MiB });
      // Second batch returns 3 more deals (30 MiB freed, excess cleared)
      const deal2 = makeDeal({ id: "deal-2", pieceId: 2, pieceSize: 10 * MiB });
      const deal3 = makeDeal({ id: "deal-3", pieceId: 3, pieceSize: 10 * MiB });
      const deal4 = makeDeal({ id: "deal-4", pieceId: 4, pieceSize: 10 * MiB });
      dealRepoMock.find.mockResolvedValueOnce([deal1]).mockResolvedValueOnce([deal2, deal3, deal4]);

      const deletePieceSpy = vi.spyOn(service, "deletePiece").mockResolvedValue(undefined);

      const result = await service.cleanupPiecesForProvider("0xProvider");

      expect(result.deleted).toBe(4);
      expect(deletePieceSpy).toHaveBeenCalledTimes(4);
      // find should have been called twice (two batches)
      expect(dealRepoMock.find).toHaveBeenCalledTimes(2);
    });
  });

  describe("deletePiece", () => {
    it("throws when deal is missing pieceId", async () => {
      const deal = makeDeal({ pieceId: undefined });

      await expect(service.deletePiece(deal)).rejects.toThrow("missing pieceId");
    });

    it("throws when deal is missing dataSetId", async () => {
      const deal = makeDeal({ dataSetId: undefined });

      await expect(service.deletePiece(deal)).rejects.toThrow("missing dataSetId");
    });

    it("calls Synapse SDK to delete piece and marks deal as cleaned up", async () => {
      const { createSynapseFromConfig } = await import("../common/synapse-factory.js");
      const deletePieceMock = vi.fn().mockResolvedValue(undefined);
      const createContextMock = vi.fn().mockResolvedValue({
        deletePiece: deletePieceMock,
      });
      (createSynapseFromConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
        synapse: {
          storage: {
            createContext: createContextMock,
          },
        },
        isSessionKeyMode: false,
      });

      const deal = makeDeal({ pieceId: 42, dataSetId: 1n, spAddress: "0xProvider" });
      dealRepoMock.save.mockResolvedValue(deal);

      await service.deletePiece(deal);

      expect(createContextMock).toHaveBeenCalledWith({
        providerId: 9,
        dataSetId: 1n,
      });
      expect(deletePieceMock).toHaveBeenCalledWith({ piece: 42n });
      expect(deal.cleanedUp).toBe(true);
      expect(deal.cleanedUpAt).toBeInstanceOf(Date);
      expect(dealRepoMock.save).toHaveBeenCalledWith(deal);
    });

    it("treats 'Can only schedule removal of live pieces' revert as idempotent success", async () => {
      const { createSynapseFromConfig } = await import("../common/synapse-factory.js");
      const deletePieceMock = vi.fn().mockRejectedValue(new Error("Can only schedule removal of live pieces"));
      const createContextMock = vi.fn().mockResolvedValue({
        deletePiece: deletePieceMock,
      });
      (createSynapseFromConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
        synapse: {
          storage: {
            createContext: createContextMock,
          },
        },
        isSessionKeyMode: false,
      });

      const deal = makeDeal({ pieceId: 42, dataSetId: 1n, spAddress: "0xProvider" });
      dealRepoMock.save.mockResolvedValue(deal);

      await service.deletePiece(deal);

      expect(deal.cleanedUp).toBe(true);
      expect(deal.cleanedUpAt).toBeInstanceOf(Date);
      expect(dealRepoMock.save).toHaveBeenCalledWith(deal);
    });

    it("treats 'Piece ID already scheduled for removal' revert as idempotent success", async () => {
      const { createSynapseFromConfig } = await import("../common/synapse-factory.js");
      const deletePieceMock = vi.fn().mockRejectedValue(new Error("Piece ID already scheduled for removal"));
      const createContextMock = vi.fn().mockResolvedValue({
        deletePiece: deletePieceMock,
      });
      (createSynapseFromConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
        synapse: {
          storage: {
            createContext: createContextMock,
          },
        },
        isSessionKeyMode: false,
      });

      const deal = makeDeal({ pieceId: 42, dataSetId: 1n, spAddress: "0xProvider" });
      dealRepoMock.save.mockResolvedValue(deal);

      await service.deletePiece(deal);

      expect(deal.cleanedUp).toBe(true);
      expect(dealRepoMock.save).toHaveBeenCalledWith(deal);
    });

    it("rethrows non-idempotent errors", async () => {
      const { createSynapseFromConfig } = await import("../common/synapse-factory.js");
      const deletePieceMock = vi.fn().mockRejectedValue(new Error("network timeout"));
      const createContextMock = vi.fn().mockResolvedValue({
        deletePiece: deletePieceMock,
      });
      (createSynapseFromConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
        synapse: {
          storage: {
            createContext: createContextMock,
          },
        },
        isSessionKeyMode: false,
      });

      const deal = makeDeal({ pieceId: 42, dataSetId: 1n, spAddress: "0xProvider" });

      await expect(service.deletePiece(deal)).rejects.toThrow("network timeout");
    });

    it("respects abort signal before SDK call", async () => {
      const deal = makeDeal();
      const abortController = new AbortController();
      abortController.abort(new Error("cancelled"));

      await expect(service.deletePiece(deal, abortController.signal)).rejects.toThrow("cancelled");
    });
  });
});
