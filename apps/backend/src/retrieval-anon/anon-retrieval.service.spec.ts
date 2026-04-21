import type { Repository } from "typeorm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnonRetrieval } from "../database/entities/anon-retrieval.entity.js";
import type { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { RetrievalStatus } from "../database/types.js";
import type { AnonRetrievalCheckMetrics } from "../metrics-prometheus/check-metrics.service.js";
import type { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import type { AnonPieceSelectorService } from "./anon-piece-selector.service.js";
import { AnonRetrievalService } from "./anon-retrieval.service.js";
import type { CarValidationService } from "./car-validation.service.js";
import type { PieceRetrievalService } from "./piece-retrieval.service.js";
import type { PieceRetrievalResult } from "./types.js";

const SP_ADDRESS = "0xaaaa0000000000000000000000000000000000aa";

const PIECE = {
  pieceCid: "baga6ea4seaqpiece",
  pieceId: "1",
  dataSetId: "42",
  rawSize: "1048576",
  withIPFSIndexing: false,
  ipfsRootCid: null,
  serviceProvider: SP_ADDRESS,
};

function makeProvider(): StorageProvider {
  return {
    address: SP_ADDRESS,
    providerId: 7,
    name: "sp-test",
    isApproved: true,
  } as unknown as StorageProvider;
}

function makeService(opts: {
  pieceResult: PieceRetrievalResult;
  fetchPieceImpl?: (signal?: AbortSignal) => Promise<PieceRetrievalResult>;
}): {
  service: AnonRetrievalService;
  saveSpy: ReturnType<typeof vi.fn>;
  fetchSpy: ReturnType<typeof vi.fn>;
} {
  const saveSpy = vi.fn(async (entity: AnonRetrieval) => entity);
  const createdEntities: Partial<AnonRetrieval>[] = [];
  const anonRetrievalRepository = {
    create: vi.fn((data: Partial<AnonRetrieval>) => {
      createdEntities.push(data);
      return data;
    }),
    save: saveSpy,
  } as unknown as Repository<AnonRetrieval>;

  const spRepository = {
    findOne: vi.fn(async () => makeProvider()),
  } as unknown as Repository<StorageProvider>;

  const anonPieceSelector = {
    selectPieceForProvider: vi.fn(async () => PIECE),
  } as unknown as AnonPieceSelectorService;

  const fetchSpy = vi.fn(opts.fetchPieceImpl ?? (async () => opts.pieceResult));
  const pieceRetrievalService = {
    fetchPiece: fetchSpy,
  } as unknown as PieceRetrievalService;

  const carValidationService = {
    validateCarPiece: vi.fn(),
  } as unknown as CarValidationService;

  const walletSdkService = {
    getProviderInfo: vi.fn(() => ({ pdp: { serviceURL: "https://sp.test/" } })),
  } as unknown as WalletSdkService;

  const metrics = {
    observeFirstByteMs: vi.fn(),
    observeLastByteMs: vi.fn(),
    observeThroughput: vi.fn(),
    observeCheckDuration: vi.fn(),
    recordStatus: vi.fn(),
    recordHttpResponseCode: vi.fn(),
    recordCarParseStatus: vi.fn(),
    recordIpniStatus: vi.fn(),
    recordBlockFetchStatus: vi.fn(),
  } as unknown as AnonRetrievalCheckMetrics;

  const service = new AnonRetrievalService(
    anonPieceSelector,
    pieceRetrievalService,
    carValidationService,
    walletSdkService,
    metrics,
    anonRetrievalRepository,
    spRepository,
  );

  return { service, saveSpy, fetchSpy };
}

describe("AnonRetrievalService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists partial metrics when fetchPiece returns aborted=true", async () => {
    const partial: PieceRetrievalResult = {
      success: false,
      pieceCid: PIECE.pieceCid,
      bytesReceived: 524288,
      pieceBytes: null,
      latencyMs: 42000,
      ttfbMs: 150,
      throughputBps: 12500,
      statusCode: 200,
      commPValid: false,
      errorMessage: "Anon retrieval job timeout (60s) for sp1",
      aborted: true,
    };

    const { service, saveSpy } = makeService({ pieceResult: partial });

    await service.performForProvider(SP_ADDRESS);

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const saved = saveSpy.mock.calls[0][0] as Partial<AnonRetrieval>;
    expect(saved.status).toBe(RetrievalStatus.FAILED);
    expect(saved.bytesRetrieved).toBe(524288);
    expect(saved.ttfbMs).toBe(150);
    expect(saved.latencyMs).toBe(42000);
    expect(saved.throughputBps).toBe(12500);
    expect(saved.responseCode).toBe(200);
    expect(saved.errorMessage).toContain("Anon retrieval job timeout");
  });

  it("still saves a row when the signal aborts before fetchPiece runs", async () => {
    const ac = new AbortController();
    ac.abort(new Error("Anon retrieval job timeout (60s) for sp1"));

    const never: PieceRetrievalResult = {
      success: false,
      pieceCid: PIECE.pieceCid,
      bytesReceived: 0,
      pieceBytes: null,
      latencyMs: 0,
      ttfbMs: 0,
      throughputBps: 0,
      statusCode: 0,
      commPValid: false,
    };

    const { service, saveSpy, fetchSpy } = makeService({ pieceResult: never });

    await service.performForProvider(SP_ADDRESS, ac.signal);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalledTimes(1);
    const saved = saveSpy.mock.calls[0][0] as Partial<AnonRetrieval>;
    expect(saved.status).toBe(RetrievalStatus.FAILED);
    expect(saved.errorMessage).toContain("Anon retrieval job timeout");
    expect(saved.bytesRetrieved).toBeNull();
    expect(saved.ttfbMs).toBeNull();
  });

  it("still saves a row when fetchPiece throws unexpectedly", async () => {
    const never: PieceRetrievalResult = {
      success: false,
      pieceCid: PIECE.pieceCid,
      bytesReceived: 0,
      pieceBytes: null,
      latencyMs: 0,
      ttfbMs: 0,
      throughputBps: 0,
      statusCode: 0,
      commPValid: false,
    };

    const { service, saveSpy } = makeService({
      pieceResult: never,
      fetchPieceImpl: async () => {
        throw new Error("network down");
      },
    });

    await expect(service.performForProvider(SP_ADDRESS)).rejects.toThrow("network down");

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const saved = saveSpy.mock.calls[0][0] as Partial<AnonRetrieval>;
    expect(saved.status).toBe(RetrievalStatus.FAILED);
  });
});
