import type { StorageContext } from "@filoz/synapse-sdk";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
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
      create: vi.fn().mockResolvedValue({
        storage: {
          createContext: vi.fn().mockResolvedValue({
            deletePiece: vi.fn(),
          } as unknown as StorageContext),
        },
      }),
    },
  };
});

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
      getFWSSAddress: vi.fn().mockReturnValue("0xFWSS"),
    };
  }

  function createConfigMock() {
    return {
      get: vi.fn((key: keyof IConfig) => {
        if (key === "pieceCleanup") {
          return {
            maxDatasetStorageSizeBytes: THRESHOLD_BYTES,
          };
        }
        if (key === "blockchain") {
          return {
            walletPrivateKey: "mockPrivateKey",
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
    deal.dataSetId = Object.hasOwn(overrides, "dataSetId") ? (overrides.dataSetId as number) : 1;
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

  describe("isProviderOverQuota", () => {
    it("returns true when stored bytes exceed threshold", async () => {
      mockQueryBuilder(THRESHOLD_BYTES + 1);

      const result = await service.isProviderOverQuota("0xProvider");

      expect(result).toBe(true);
    });

    it("returns false when stored bytes are at threshold", async () => {
      mockQueryBuilder(THRESHOLD_BYTES);

      const result = await service.isProviderOverQuota("0xProvider");

      expect(result).toBe(false);
    });

    it("returns false when stored bytes are below threshold", async () => {
      mockQueryBuilder(THRESHOLD_BYTES - 1);

      const result = await service.isProviderOverQuota("0xProvider");

      expect(result).toBe(false);
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
      mockQueryBuilder(50 * MiB); // 50 MiB < 100 MiB threshold

      const result = await service.cleanupPiecesForProvider("0xProvider");

      expect(result.skipped).toBe(true);
      expect(result.deleted).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.storedBytes).toBe(50 * MiB);
      expect(result.thresholdBytes).toBe(THRESHOLD_BYTES);
    });

    it("skips cleanup when stored bytes equal threshold", async () => {
      mockQueryBuilder(THRESHOLD_BYTES); // exactly at threshold

      const result = await service.cleanupPiecesForProvider("0xProvider");

      expect(result.skipped).toBe(true);
      expect(result.deleted).toBe(0);
    });

    it("returns cleanup result with no candidates when above threshold but no eligible deals", async () => {
      mockQueryBuilder(200 * MiB); // above threshold
      dealRepoMock.find.mockResolvedValue([]); // no candidates

      const result = await service.cleanupPiecesForProvider("0xProvider");

      expect(result.skipped).toBe(false);
      expect(result.deleted).toBe(0);
      expect(result.failed).toBe(0);
    });

    it("deletes pieces until excess is cleared", async () => {
      const excessBytes = 30 * MiB;
      mockQueryBuilder(THRESHOLD_BYTES + excessBytes);

      const deal1 = makeDeal({ id: "deal-1", pieceId: 1, pieceSize: 10 * MiB });
      const deal2 = makeDeal({ id: "deal-2", pieceId: 2, pieceSize: 10 * MiB });
      const deal3 = makeDeal({ id: "deal-3", pieceId: 3, pieceSize: 10 * MiB });
      const deal4 = makeDeal({ id: "deal-4", pieceId: 4, pieceSize: 10 * MiB }); // won't be reached
      dealRepoMock.find.mockResolvedValue([deal1, deal2, deal3, deal4]);

      const deletePieceSpy = vi.spyOn(service, "deletePiece").mockResolvedValue(undefined);

      const result = await service.cleanupPiecesForProvider("0xProvider");

      expect(result.deleted).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(false);
      // Should not delete the 4th piece since excess is already cleared
      expect(deletePieceSpy).toHaveBeenCalledTimes(3);
    });

    it("continues deleting after individual piece failure", async () => {
      mockQueryBuilder(200 * MiB);

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
      mockQueryBuilder(200 * MiB);

      const deal1 = makeDeal({ id: "deal-1", pieceId: 1, pieceSize: 10 * MiB });
      dealRepoMock.find.mockResolvedValue([deal1]);

      const abortController = new AbortController();
      abortController.abort(new Error("aborted"));

      await expect(service.cleanupPiecesForProvider("0xProvider", abortController.signal)).rejects.toThrow("aborted");
    });

    it("bails out when all deletions in a batch fail", async () => {
      mockQueryBuilder(200 * MiB);

      const deal1 = makeDeal({ id: "deal-1", pieceId: 1, pieceSize: 10 * MiB });
      const deal2 = makeDeal({ id: "deal-2", pieceId: 2, pieceSize: 10 * MiB });
      dealRepoMock.find.mockResolvedValue([deal1, deal2]);

      vi.spyOn(service, "deletePiece").mockRejectedValue(new Error("persistent failure"));

      const result = await service.cleanupPiecesForProvider("0xProvider");

      expect(result.deleted).toBe(0);
      expect(result.failed).toBe(2);
      expect(result.skipped).toBe(false);
    });

    it("uses fileSize as fallback when pieceSize is 0", async () => {
      const excessBytes = 10 * MiB;
      mockQueryBuilder(THRESHOLD_BYTES + excessBytes);

      const deal1 = makeDeal({ id: "deal-1", pieceId: 1, pieceSize: 0, fileSize: 10 * MiB });
      dealRepoMock.find.mockResolvedValue([deal1]);

      const deletePieceSpy = vi.spyOn(service, "deletePiece").mockResolvedValue(undefined);

      const result = await service.cleanupPiecesForProvider("0xProvider");

      expect(result.deleted).toBe(1);
      expect(deletePieceSpy).toHaveBeenCalledTimes(1);
    });

    it("loops through multiple batches when excess spans batches", async () => {
      const excessBytes = 20 * MiB;
      mockQueryBuilder(THRESHOLD_BYTES + excessBytes);

      // First batch returns 1 deal (10 MiB freed, still 10 MiB excess)
      const deal1 = makeDeal({ id: "deal-1", pieceId: 1, pieceSize: 10 * MiB });
      // Second batch returns 1 more deal (10 MiB freed, excess cleared)
      const deal2 = makeDeal({ id: "deal-2", pieceId: 2, pieceSize: 10 * MiB });
      dealRepoMock.find.mockResolvedValueOnce([deal1]).mockResolvedValueOnce([deal2]);

      const deletePieceSpy = vi.spyOn(service, "deletePiece").mockResolvedValue(undefined);

      const result = await service.cleanupPiecesForProvider("0xProvider");

      expect(result.deleted).toBe(2);
      expect(deletePieceSpy).toHaveBeenCalledTimes(2);
      // find should have been called twice (two batches)
      expect(dealRepoMock.find).toHaveBeenCalledTimes(2);
    });
  });

  describe("deletePiece", () => {
    it("throws when deal is missing pieceId", async () => {
      const deal = makeDeal({ pieceId: undefined });

      await expect(service.deletePiece(deal)).rejects.toThrow("missing pieceId");
    });

    it("calls Synapse SDK to delete piece and marks deal as cleaned up", async () => {
      const { Synapse } = await import("@filoz/synapse-sdk");
      const deletePieceMock = vi.fn().mockResolvedValue(undefined);
      const createContextMock = vi.fn().mockResolvedValue({
        deletePiece: deletePieceMock,
      });
      (Synapse.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        storage: {
          createContext: createContextMock,
        },
      });

      const deal = makeDeal({ pieceId: 42, dataSetId: 1, spAddress: "0xProvider" });
      dealRepoMock.save.mockResolvedValue(deal);

      await service.deletePiece(deal);

      expect(createContextMock).toHaveBeenCalledWith({
        providerAddress: "0xProvider",
      });
      expect(deletePieceMock).toHaveBeenCalledWith(42);
      expect(deal.cleanedUp).toBe(true);
      expect(deal.cleanedUpAt).toBeInstanceOf(Date);
      expect(dealRepoMock.save).toHaveBeenCalledWith(deal);
    });

    it("treats 'Can only schedule removal of live pieces' revert as idempotent success", async () => {
      const { Synapse } = await import("@filoz/synapse-sdk");
      const deletePieceMock = vi.fn().mockRejectedValue(new Error("Can only schedule removal of live pieces"));
      const createContextMock = vi.fn().mockResolvedValue({
        deletePiece: deletePieceMock,
      });
      (Synapse.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        storage: {
          createContext: createContextMock,
        },
      });

      const deal = makeDeal({ pieceId: 42, dataSetId: 1, spAddress: "0xProvider" });
      dealRepoMock.save.mockResolvedValue(deal);

      await service.deletePiece(deal);

      expect(deal.cleanedUp).toBe(true);
      expect(deal.cleanedUpAt).toBeInstanceOf(Date);
      expect(dealRepoMock.save).toHaveBeenCalledWith(deal);
    });

    it("treats 'Piece ID already scheduled for removal' revert as idempotent success", async () => {
      const { Synapse } = await import("@filoz/synapse-sdk");
      const deletePieceMock = vi.fn().mockRejectedValue(new Error("Piece ID already scheduled for removal"));
      const createContextMock = vi.fn().mockResolvedValue({
        deletePiece: deletePieceMock,
      });
      (Synapse.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        storage: {
          createContext: createContextMock,
        },
      });

      const deal = makeDeal({ pieceId: 42, dataSetId: 1, spAddress: "0xProvider" });
      dealRepoMock.save.mockResolvedValue(deal);

      await service.deletePiece(deal);

      expect(deal.cleanedUp).toBe(true);
      expect(dealRepoMock.save).toHaveBeenCalledWith(deal);
    });

    it("rethrows non-idempotent errors", async () => {
      const { Synapse } = await import("@filoz/synapse-sdk");
      const deletePieceMock = vi.fn().mockRejectedValue(new Error("network timeout"));
      const createContextMock = vi.fn().mockResolvedValue({
        deletePiece: deletePieceMock,
      });
      (Synapse.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        storage: {
          createContext: createContextMock,
        },
      });

      const deal = makeDeal({ pieceId: 42, dataSetId: 1, spAddress: "0xProvider" });

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
