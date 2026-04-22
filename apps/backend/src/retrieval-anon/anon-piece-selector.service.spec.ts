import type { ConfigService } from "@nestjs/config";
import type { Repository } from "typeorm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IConfig } from "../config/app.config.js";
import type { Retrieval } from "../database/entities/retrieval.entity.js";
import type { SubgraphService } from "../subgraph/subgraph.service.js";
import type { FwssCandidatePiece } from "../subgraph/types.js";
import { AnonPieceSelectorService } from "./anon-piece-selector.service.js";

const SP_ADDRESS = "0xAaAaAAaAaaaAaAAAAaaaaAAaaAaaaAAaaaaa1111";
const DEALBOT_PAYER = "0xBbBBBbBBbbbBbBBBBBbbbbbBBbbBbbbBBbbbb2222";

const makePiece = (overrides: Partial<FwssCandidatePiece> = {}): FwssCandidatePiece => ({
  pieceCid: `baga6ea4seaqpiece${Math.random().toString(36).slice(2, 10)}`,
  pieceId: "1",
  dataSetId: "42",
  rawSize: "1048576",
  withIPFSIndexing: true,
  ipfsRootCid: "bafyroot",
  ...overrides,
});

const makeRetrievalRepository = (recentPieceCids: string[]): Repository<Retrieval> => {
  const queryBuilder = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    getRawMany: vi.fn().mockResolvedValue(recentPieceCids.map((c) => ({ anonPieceCid: c }))),
  };
  return {
    createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
  } as unknown as Repository<Retrieval>;
};

const makeConfigService = (): ConfigService<IConfig, true> =>
  ({
    get: vi.fn((key: string) => {
      if (key === "blockchain") {
        return { walletAddress: DEALBOT_PAYER };
      }
      return undefined;
    }),
  }) as unknown as ConfigService<IConfig, true>;

describe("AnonPieceSelectorService", () => {
  let subgraphService: SubgraphService;
  let listFwssCandidatePieces: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    listFwssCandidatePieces = vi.fn();
    subgraphService = { listFwssCandidatePieces } as unknown as SubgraphService;
  });

  it("returns null when the subgraph yields no candidates", async () => {
    listFwssCandidatePieces.mockResolvedValue([]);
    const service = new AnonPieceSelectorService(subgraphService, makeConfigService(), makeRetrievalRepository([]));

    const result = await service.selectPieceForProvider(SP_ADDRESS);

    expect(result).toBeNull();
    expect(listFwssCandidatePieces).toHaveBeenCalledWith(SP_ADDRESS, DEALBOT_PAYER);
  });

  it("filters out pieces tested in the recent retrieval window", async () => {
    const freshCid = "baga6ea4seaqfresh";
    const staleCid = "baga6ea4seaqstale";
    listFwssCandidatePieces.mockResolvedValue([
      makePiece({ pieceCid: staleCid, pieceId: "1" }),
      makePiece({ pieceCid: freshCid, pieceId: "2" }),
    ]);
    const service = new AnonPieceSelectorService(
      subgraphService,
      makeConfigService(),
      makeRetrievalRepository([staleCid]),
    );

    const result = await service.selectPieceForProvider(SP_ADDRESS);

    expect(result).not.toBeNull();
    expect(result?.pieceCid).toBe(freshCid);
  });

  it("falls back to the full candidate pool when every piece has been tested recently", async () => {
    const cid = "baga6ea4seaqonly";
    listFwssCandidatePieces.mockResolvedValue([makePiece({ pieceCid: cid })]);
    const service = new AnonPieceSelectorService(subgraphService, makeConfigService(), makeRetrievalRepository([cid]));

    const result = await service.selectPieceForProvider(SP_ADDRESS);

    expect(result?.pieceCid).toBe(cid);
  });

  it("prefers IPFS-indexed pieces with an ipfsRootCid when selecting", async () => {
    const pieces = [
      makePiece({ pieceCid: "baga-plain-1", withIPFSIndexing: false, ipfsRootCid: null }),
      makePiece({ pieceCid: "baga-indexed-1", withIPFSIndexing: true, ipfsRootCid: "bafy1" }),
      makePiece({ pieceCid: "baga-plain-2", withIPFSIndexing: false, ipfsRootCid: null }),
      makePiece({ pieceCid: "baga-indexed-2", withIPFSIndexing: true, ipfsRootCid: "bafy2" }),
    ];
    listFwssCandidatePieces.mockResolvedValue(pieces);
    const service = new AnonPieceSelectorService(subgraphService, makeConfigService(), makeRetrievalRepository([]));

    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    const result = await service.selectPieceForProvider(SP_ADDRESS);

    expect(result?.pieceCid).toBe("baga-indexed-1");
    randomSpy.mockRestore();
  });

  it("falls back to all pieces when none are IPFS-indexed", async () => {
    const pieces = [
      makePiece({ pieceCid: "baga-plain-1", withIPFSIndexing: false, ipfsRootCid: null }),
      makePiece({ pieceCid: "baga-plain-2", withIPFSIndexing: true, ipfsRootCid: null }),
    ];
    listFwssCandidatePieces.mockResolvedValue(pieces);
    const service = new AnonPieceSelectorService(subgraphService, makeConfigService(), makeRetrievalRepository([]));

    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const result = await service.selectPieceForProvider(SP_ADDRESS);

    expect(["baga-plain-1", "baga-plain-2"]).toContain(result?.pieceCid);
    randomSpy.mockRestore();
  });

  it("returns lowercase SP address on the selected piece", async () => {
    listFwssCandidatePieces.mockResolvedValue([makePiece()]);
    const service = new AnonPieceSelectorService(subgraphService, makeConfigService(), makeRetrievalRepository([]));

    const result = await service.selectPieceForProvider(SP_ADDRESS);

    expect(result?.serviceProvider).toBe(SP_ADDRESS.toLowerCase());
  });
});
