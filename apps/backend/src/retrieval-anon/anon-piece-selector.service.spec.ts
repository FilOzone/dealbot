import type { ConfigService } from "@nestjs/config";
import type { Repository } from "typeorm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IConfig } from "../config/app.config.js";
import type { Retrieval } from "../database/entities/retrieval.entity.js";
import type { SampleAnonPieceParams, SubgraphService } from "../subgraph/subgraph.service.js";
import type { AnonCandidatePiece } from "../subgraph/types.js";
import { AnonPieceSelectorService } from "./anon-piece-selector.service.js";

const SP_ADDRESS = "0xAaAaAAaAaaaAaAAAAaaaaAAaaAaaaAAaaaaa1111";
const DEALBOT_PAYER = "0xBbBBBbBBbbbBbBBBBBbbbbbBBbbBbbbBBbbbb2222";

const makePiece = (overrides: Partial<AnonCandidatePiece> = {}): AnonCandidatePiece => ({
  pieceCid: `baga6ea4seaqpiece${Math.random().toString(36).slice(2, 10)}`,
  pieceId: "1",
  dataSetId: "42",
  rawSize: "1048576",
  withIPFSIndexing: true,
  ipfsRootCid: "bafyroot",
  indexedAtBlock: 12345,
  pdpPaymentEndEpoch: null,
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
  let sampleAnonPiece: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sampleAnonPiece = vi.fn();
    subgraphService = { sampleAnonPiece } as unknown as SubgraphService;
  });

  it("returns null when every fallback attempt yields no piece", async () => {
    sampleAnonPiece.mockResolvedValue(null);
    const service = new AnonPieceSelectorService(subgraphService, makeConfigService(), makeRetrievalRepository([]));

    const result = await service.selectPieceForProvider(SP_ADDRESS);

    expect(result).toBeNull();
    expect(sampleAnonPiece).toHaveBeenCalled();
  });

  it("returns the sampled piece with SP address lowercased", async () => {
    sampleAnonPiece.mockResolvedValueOnce(makePiece({ pieceCid: "baga-the-one" }));
    const service = new AnonPieceSelectorService(subgraphService, makeConfigService(), makeRetrievalRepository([]));

    const result = await service.selectPieceForProvider(SP_ADDRESS);

    expect(result).not.toBeNull();
    expect(result?.pieceCid).toBe("baga-the-one");
    expect(result?.serviceProvider).toBe(SP_ADDRESS.toLowerCase());
  });

  it("passes the dealbot payer address to sampleAnonPiece for exclusion", async () => {
    sampleAnonPiece.mockResolvedValueOnce(makePiece());
    const service = new AnonPieceSelectorService(subgraphService, makeConfigService(), makeRetrievalRepository([]));

    await service.selectPieceForProvider(SP_ADDRESS);

    const call = sampleAnonPiece.mock.calls[0][0] as SampleAnonPieceParams;
    expect(call.payer).toBe(DEALBOT_PAYER);
    expect(call.serviceProvider).toBe(SP_ADDRESS);
  });

  it("redraws when the first sampled piece's payment has already terminated", async () => {
    const staleCid = "baga-terminated";
    const freshCid = "baga-live";
    sampleAnonPiece
      .mockResolvedValueOnce(makePiece({ pieceCid: staleCid, pdpPaymentEndEpoch: 100n, indexedAtBlock: 200 }))
      .mockResolvedValueOnce(makePiece({ pieceCid: freshCid, pdpPaymentEndEpoch: null }));

    const service = new AnonPieceSelectorService(subgraphService, makeConfigService(), makeRetrievalRepository([]));
    const result = await service.selectPieceForProvider(SP_ADDRESS);

    expect(result?.pieceCid).toBe(freshCid);
  });

  it("redraws when the first sampled piece was recently tested", async () => {
    const staleCid = "baga-stale";
    const freshCid = "baga-fresh";
    sampleAnonPiece
      .mockResolvedValueOnce(makePiece({ pieceCid: staleCid }))
      .mockResolvedValueOnce(makePiece({ pieceCid: freshCid }));

    const service = new AnonPieceSelectorService(
      subgraphService,
      makeConfigService(),
      makeRetrievalRepository([staleCid]),
    );
    const result = await service.selectPieceForProvider(SP_ADDRESS);

    expect(result?.pieceCid).toBe(freshCid);
  });

  it("falls back to the opposite pool when the preferred one is empty", async () => {
    // First pool call returns nothing twice (both attempts), second pool succeeds.
    const fresh = makePiece({ pieceCid: "baga-other-pool" });
    sampleAnonPiece.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(fresh);

    const service = new AnonPieceSelectorService(subgraphService, makeConfigService(), makeRetrievalRepository([]));
    const result = await service.selectPieceForProvider(SP_ADDRESS);

    expect(result?.pieceCid).toBe("baga-other-pool");

    // The second (fallback) call should target the opposite pool.
    const firstCall = sampleAnonPiece.mock.calls[0][0] as SampleAnonPieceParams;
    const fallbackCall = sampleAnonPiece.mock.calls[2][0] as SampleAnonPieceParams;
    expect(fallbackCall.pool).not.toBe(firstCall.pool);
  });

  it("widens size bucket to 'any' after both pools fail in the primary bucket", async () => {
    // 4 empty attempts across (bucket × both pools × 2 draws each) then
    // succeed on the first `any` bucket call.
    sampleAnonPiece
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makePiece({ pieceCid: "baga-any-bucket" }));

    const service = new AnonPieceSelectorService(subgraphService, makeConfigService(), makeRetrievalRepository([]));
    const result = await service.selectPieceForProvider(SP_ADDRESS);

    expect(result?.pieceCid).toBe("baga-any-bucket");

    // The 5th call (index 4) should be the widened-bucket attempt; its size
    // range covers at least the 32 GiB ceiling of the "large" bucket.
    const widened = sampleAnonPiece.mock.calls[4][0] as SampleAnonPieceParams;
    expect(BigInt(widened.maxSize)).toBeGreaterThanOrEqual(32n * 1024n * 1024n * 1024n);
    expect(widened.minSize).toBe("0");
  });

  it("draws a fresh sampleKey for each subgraph call", async () => {
    sampleAnonPiece.mockResolvedValueOnce(null).mockResolvedValueOnce(makePiece());

    const service = new AnonPieceSelectorService(subgraphService, makeConfigService(), makeRetrievalRepository([]));
    await service.selectPieceForProvider(SP_ADDRESS);

    const call1 = sampleAnonPiece.mock.calls[0][0] as SampleAnonPieceParams;
    const call2 = sampleAnonPiece.mock.calls[1][0] as SampleAnonPieceParams;
    expect(call1.sampleKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(call2.sampleKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(call1.sampleKey).not.toBe(call2.sampleKey);
  });
});
