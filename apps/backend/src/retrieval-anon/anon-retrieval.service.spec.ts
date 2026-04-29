import type { Repository } from "typeorm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClickhouseService } from "../clickhouse/clickhouse.service.js";
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
  clickhouseEnabled?: boolean;
}): {
  service: AnonRetrievalService;
  insertSpy: ReturnType<typeof vi.fn>;
  fetchSpy: ReturnType<typeof vi.fn>;
} {
  const insertSpy = vi.fn();
  const clickhouseService = {
    insert: insertSpy,
    enabled: opts.clickhouseEnabled ?? true,
    probeLocation: "test-location",
  } as unknown as ClickhouseService;

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
    clickhouseService,
    spRepository,
  );

  return { service, insertSpy, fetchSpy };
}

describe("AnonRetrievalService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits a ClickHouse row with partial metrics when fetchPiece returns aborted=true", async () => {
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

    const { service, insertSpy } = makeService({ pieceResult: partial });

    await service.performForProvider(SP_ADDRESS);

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const [table, row] = insertSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(table).toBe("anon_retrieval_checks");
    expect(row.status).toBe(RetrievalStatus.FAILED);
    expect(row.bytes_retrieved).toBe(524288);
    expect(row.first_byte_ms).toBe(150);
    expect(row.last_byte_ms).toBe(42000);
    expect(row.throughput_bps).toBe(12500);
    expect(row.http_response_code).toBe(200);
    expect(row.error_message).toContain("Anon retrieval job timeout");
    expect(row.piece_cid).toBe(PIECE.pieceCid);
    expect(row.sp_address).toBe(SP_ADDRESS);
    expect(row.sp_id).toBe(7);
    expect(row.probe_location).toBe("test-location");
    expect(typeof row.retrieval_id).toBe("string");
  });

  it("still emits a row when the signal aborts before fetchPiece runs", async () => {
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

    const { service, insertSpy, fetchSpy } = makeService({ pieceResult: never });

    await service.performForProvider(SP_ADDRESS, ac.signal);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const [, row] = insertSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(row.status).toBe(RetrievalStatus.FAILED);
    expect(row.error_message).toContain("Anon retrieval job timeout");
    expect(row.bytes_retrieved).toBeNull();
    expect(row.first_byte_ms).toBeNull();
  });

  it("still emits a row when fetchPiece throws unexpectedly", async () => {
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

    const { service, insertSpy } = makeService({
      pieceResult: never,
      fetchPieceImpl: async () => {
        throw new Error("network down");
      },
    });

    await expect(service.performForProvider(SP_ADDRESS)).rejects.toThrow("network down");

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const [, row] = insertSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(row.status).toBe(RetrievalStatus.FAILED);
  });

  it("skips ClickHouse insert when ClickHouse is disabled", async () => {
    const ok: PieceRetrievalResult = {
      success: true,
      pieceCid: PIECE.pieceCid,
      bytesReceived: 1024,
      pieceBytes: null,
      latencyMs: 100,
      ttfbMs: 10,
      throughputBps: 10240,
      statusCode: 200,
      commPValid: true,
    };

    const { service, insertSpy } = makeService({ pieceResult: ok, clickhouseEnabled: false });

    await service.performForProvider(SP_ADDRESS);

    expect(insertSpy).not.toHaveBeenCalled();
  });
});
