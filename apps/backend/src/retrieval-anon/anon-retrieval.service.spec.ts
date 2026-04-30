import type { Repository } from "typeorm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClickhouseService } from "../clickhouse/clickhouse.service.js";
import type { AnonRetrieval } from "../database/entities/anon-retrieval.entity.js";
import type { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { IpniCheckStatus, PieceFetchStatus } from "../database/types.js";
import type { AnonRetrievalCheckMetrics } from "../metrics-prometheus/check-metrics.service.js";
import type { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import type { AnonPieceSelectorService } from "./anon-piece-selector.service.js";
import { AnonRetrievalService } from "./anon-retrieval.service.js";
import type { CarValidationService } from "./car-validation.service.js";
import type { PieceRetrievalService } from "./piece-retrieval.service.js";
import type { AnonPiece, CarValidationResult, PieceRetrievalResult } from "./types.js";

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
    providerId: 7n,
    name: "sp-test",
    isApproved: true,
  } as unknown as StorageProvider;
}

function makeService(opts: {
  pieceResult: PieceRetrievalResult;
  fetchPieceImpl?: (signal?: AbortSignal) => Promise<PieceRetrievalResult>;
  clickhouseEnabled?: boolean;
  piece?: AnonPiece | null;
  carResult?: CarValidationResult;
  validateCarImpl?: () => Promise<CarValidationResult>;
  saveImpl?: (entity: AnonRetrieval) => Promise<AnonRetrieval>;
}): {
  service: AnonRetrievalService;
  insertSpy: ReturnType<typeof vi.fn>;
  fetchSpy: ReturnType<typeof vi.fn>;
  validateCarSpy: ReturnType<typeof vi.fn>;
  metricsRecordStatusSpy: ReturnType<typeof vi.fn>;
  metricsRecordIpniSpy: ReturnType<typeof vi.fn>;
  metricsRecordBlockFetchSpy: ReturnType<typeof vi.fn>;
  saveSpy: ReturnType<typeof vi.fn>;
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

  const saveSpy = vi.fn(opts.saveImpl ?? (async (entity: AnonRetrieval) => entity));
  const anonRetrievalRepository = {
    save: saveSpy,
  } as unknown as Repository<AnonRetrieval>;

  const anonPieceSelector = {
    selectPieceForProvider: vi.fn(async () => (opts.piece === null ? null : (opts.piece ?? PIECE))),
  } as unknown as AnonPieceSelectorService;

  const fetchSpy = vi.fn(opts.fetchPieceImpl ?? (async () => opts.pieceResult));
  const pieceRetrievalService = {
    fetchPiece: fetchSpy,
  } as unknown as PieceRetrievalService;

  const validateCarSpy = vi.fn(opts.validateCarImpl ?? (async () => opts.carResult));
  const carValidationService = {
    validateCarPiece: validateCarSpy,
  } as unknown as CarValidationService;

  const walletSdkService = {
    getProviderInfo: vi.fn(() => ({ pdp: { serviceURL: "https://sp.test/" } })),
  } as unknown as WalletSdkService;

  const metricsRecordStatusSpy = vi.fn();
  const metricsRecordIpniSpy = vi.fn();
  const metricsRecordBlockFetchSpy = vi.fn();
  const metrics = {
    observeFirstByteMs: vi.fn(),
    observeLastByteMs: vi.fn(),
    observeThroughput: vi.fn(),
    observeCheckDuration: vi.fn(),
    recordStatus: metricsRecordStatusSpy,
    recordHttpResponseCode: vi.fn(),
    recordCarParseStatus: vi.fn(),
    recordIpniStatus: metricsRecordIpniSpy,
    recordBlockFetchStatus: metricsRecordBlockFetchSpy,
  } as unknown as AnonRetrievalCheckMetrics;

  const service = new AnonRetrievalService(
    anonPieceSelector,
    pieceRetrievalService,
    carValidationService,
    walletSdkService,
    metrics,
    clickhouseService,
    spRepository,
    anonRetrievalRepository,
  );

  return {
    service,
    insertSpy,
    fetchSpy,
    validateCarSpy,
    metricsRecordStatusSpy,
    metricsRecordIpniSpy,
    metricsRecordBlockFetchSpy,
    saveSpy,
  };
}

describe("AnonRetrievalService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists a Postgres row with partial metrics when fetchPiece returns aborted=true", async () => {
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

    const { service, saveSpy, insertSpy } = makeService({ pieceResult: partial });

    await service.performForProvider(SP_ADDRESS);

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const entity = saveSpy.mock.calls[0]?.[0] as AnonRetrieval;
    expect(entity.pieceFetchStatus).toBe(PieceFetchStatus.FAILED);
    expect(entity.bytesRetrieved).toBe(524288n);
    expect(entity.firstByteMs).toBe(150);
    expect(entity.lastByteMs).toBe(42000);
    expect(entity.throughputBps).toBe(12500n);
    expect(entity.httpResponseCode).toBe(200);
    expect(entity.errorMessage).toContain("Anon retrieval job timeout");
    expect(entity.pieceCid).toBe(PIECE.pieceCid);
    expect(entity.spAddress).toBe(SP_ADDRESS);
    expect(entity.spId).toBe(7n);
    expect(entity.probeLocation).toBe("test-location");
    expect(entity.retrievalEndpoint).toBe(`https://sp.test/piece/${PIECE.pieceCid}`);
    expect(typeof entity.id).toBe("string");

    // CAR/IPNI/block-fetch were never run on a non-IPFS-indexed piece.
    expect(entity.carParseable).toBeNull();
    expect(entity.carBlockCount).toBeNull();
    expect(entity.blockFetchEndpoint).toBeNull();
    expect(entity.blockFetchValid).toBeNull();
    expect(entity.blockFetchSampledCount).toBeNull();
    expect(entity.blockFetchFailedCount).toBeNull();
    expect(entity.ipniStatus).toBe(IpniCheckStatus.SKIPPED);

    // ClickHouse mirror is also written.
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const [table, row] = insertSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(table).toBe("anon_retrieval_checks");
    expect(row.retrieval_id).toBe(entity.id);
    expect(row.piece_fetch_status).toBe(PieceFetchStatus.FAILED);
    expect(row.bytes_retrieved).toBe(524288);
    expect(row.first_byte_ms).toBe(150);
    expect(row.last_byte_ms).toBe(42000);
    expect(row.throughput_bps).toBe(12500);
    expect(row.http_response_code).toBe(200);
    expect(row.ipni_status).toBe(IpniCheckStatus.SKIPPED);

    // Trimmed CH columns must NOT appear (they live only in Postgres).
    expect(row).not.toHaveProperty("piece_cid");
    expect(row).not.toHaveProperty("data_set_id");
    expect(row).not.toHaveProperty("piece_id");
    expect(row).not.toHaveProperty("ipfs_root_cid");
    expect(row).not.toHaveProperty("retrieval_endpoint");
    expect(row).not.toHaveProperty("block_fetch_endpoint");
    expect(row).not.toHaveProperty("error_message");
  });

  it("still persists when the signal aborts before fetchPiece runs", async () => {
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

    const { service, saveSpy, insertSpy, fetchSpy } = makeService({ pieceResult: never });

    await service.performForProvider(SP_ADDRESS, ac.signal);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalledTimes(1);
    const entity = saveSpy.mock.calls[0]?.[0] as AnonRetrieval;
    expect(entity.pieceFetchStatus).toBe(PieceFetchStatus.FAILED);
    expect(entity.errorMessage).toContain("Anon retrieval job timeout");
    expect(entity.bytesRetrieved).toBeNull();
    expect(entity.firstByteMs).toBeNull();
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  it("still persists when fetchPiece throws unexpectedly", async () => {
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
    const entity = saveSpy.mock.calls[0]?.[0] as AnonRetrieval;
    expect(entity.pieceFetchStatus).toBe(PieceFetchStatus.FAILED);
  });

  it("does not throw when Postgres save fails and still attempts the CH insert", async () => {
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

    const { service, saveSpy, insertSpy } = makeService({
      pieceResult: ok,
      saveImpl: async () => {
        throw new Error("connection refused");
      },
    });

    await expect(service.performForProvider(SP_ADDRESS)).resolves.toBeUndefined();

    expect(saveSpy).toHaveBeenCalledTimes(1);
    // CH still gets the row keyed by the client-side uuid.
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const [, row] = insertSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(typeof row.retrieval_id).toBe("string");
  });

  describe("with IPFS indexing", () => {
    const INDEXED_PIECE: AnonPiece = {
      ...PIECE,
      withIPFSIndexing: true,
      ipfsRootCid: "bafyrootcid",
    };

    function okPiece(bytes: Buffer): PieceRetrievalResult {
      return {
        success: true,
        pieceCid: INDEXED_PIECE.pieceCid,
        bytesReceived: bytes.length,
        pieceBytes: bytes,
        latencyMs: 200,
        ttfbMs: 20,
        throughputBps: 51200,
        statusCode: 200,
        commPValid: true,
      };
    }

    it("populates CAR/IPNI/block-fetch columns when validation fully succeeds", async () => {
      const carResult: CarValidationResult = {
        carParseable: true,
        blockCount: 42,
        sampledCidCount: 5,
        ipniValid: true,
        ipniVerifyMs: 137,
        ipniVerifiedCidsCount: 6,
        ipniUnverifiedCidsCount: 0,
        blockFetchValid: true,
        blockFetchFailedCount: 0,
        blockFetchEndpoint: "https://sp.test/ipfs/",
      };

      const { service, saveSpy, insertSpy, validateCarSpy } = makeService({
        pieceResult: okPiece(Buffer.from("car-bytes")),
        piece: INDEXED_PIECE,
        carResult,
      });

      await service.performForProvider(SP_ADDRESS);

      expect(validateCarSpy).toHaveBeenCalledTimes(1);
      const entity = saveSpy.mock.calls[0]?.[0] as AnonRetrieval;
      expect(entity.pieceFetchStatus).toBe(PieceFetchStatus.SUCCESS);
      expect(entity.commpValid).toBe(true);
      expect(entity.carParseable).toBe(true);
      expect(entity.carBlockCount).toBe(42);
      expect(entity.blockFetchEndpoint).toBe("https://sp.test/ipfs/");
      expect(entity.blockFetchValid).toBe(true);
      expect(entity.blockFetchSampledCount).toBe(5);
      expect(entity.blockFetchFailedCount).toBe(0);
      expect(entity.ipniStatus).toBe(IpniCheckStatus.VALID);
      expect(entity.ipniVerifyMs).toBe(137);
      expect(entity.ipniVerifiedCidsCount).toBe(6);
      expect(entity.ipniUnverifiedCidsCount).toBe(0);

      const [, row] = insertSpy.mock.calls[0] as [string, Record<string, unknown>];
      expect(row.piece_fetch_status).toBe(PieceFetchStatus.SUCCESS);
      expect(row.car_parseable).toBe(true);
      expect(row.ipni_status).toBe(IpniCheckStatus.VALID);
    });

    it("distinguishes IPNI invalid from block-fetch failures with explicit counts", async () => {
      const carResult: CarValidationResult = {
        carParseable: true,
        blockCount: 100,
        sampledCidCount: 5,
        ipniValid: false,
        ipniVerifyMs: 250,
        ipniVerifiedCidsCount: 0,
        ipniUnverifiedCidsCount: 6,
        blockFetchValid: false,
        blockFetchFailedCount: 2,
        blockFetchEndpoint: "https://sp.test/ipfs/",
      };

      const { service, saveSpy } = makeService({
        pieceResult: okPiece(Buffer.from("car-bytes")),
        piece: INDEXED_PIECE,
        carResult,
      });

      await service.performForProvider(SP_ADDRESS);

      const entity = saveSpy.mock.calls[0]?.[0] as AnonRetrieval;
      // The piece-fetch path still succeeded — failures are surfaced as
      // independent dimensions, not folded into piece_fetch_status.
      expect(entity.pieceFetchStatus).toBe(PieceFetchStatus.SUCCESS);
      expect(entity.carParseable).toBe(true);
      expect(entity.ipniStatus).toBe(IpniCheckStatus.INVALID);
      expect(entity.ipniVerifiedCidsCount).toBe(0);
      expect(entity.ipniUnverifiedCidsCount).toBe(6);
      expect(entity.blockFetchValid).toBe(false);
      expect(entity.blockFetchSampledCount).toBe(5);
      expect(entity.blockFetchFailedCount).toBe(2);
    });

    it("emits ipni_status='error' (not 'skipped') when CAR validation throws on a successful piece", async () => {
      // Distinguishes a real infra outage (e.g. IpniVerificationService down)
      // from a piece that legitimately had no IPFS indexing. Without the
      // distinction, an outage looks like normal non-IPFS volume in dashboards.
      const { service, saveSpy, metricsRecordIpniSpy, metricsRecordBlockFetchSpy } = makeService({
        pieceResult: okPiece(Buffer.from("car-bytes")),
        piece: INDEXED_PIECE,
        validateCarImpl: async () => {
          throw new Error("IpniVerificationService down");
        },
      });

      await service.performForProvider(SP_ADDRESS);

      expect(metricsRecordIpniSpy).toHaveBeenCalledWith(expect.anything(), "error");
      expect(metricsRecordBlockFetchSpy).toHaveBeenCalledWith(expect.anything(), "error");

      const entity = saveSpy.mock.calls[0]?.[0] as AnonRetrieval;
      expect(entity.ipniStatus).toBe(IpniCheckStatus.ERROR);
      // Piece-fetch path itself succeeded — only the validation pipeline failed.
      expect(entity.commpValid).toBe(true);
      expect(entity.carParseable).toBeNull();
    });

    it("emits car_parseable=false with skipped IPNI/block-fetch when bytes don't parse as CAR", async () => {
      const carResult: CarValidationResult = {
        carParseable: false,
        blockCount: 0,
        sampledCidCount: 0,
        ipniValid: null,
        ipniVerifyMs: null,
        ipniVerifiedCidsCount: null,
        ipniUnverifiedCidsCount: null,
        blockFetchValid: null,
        blockFetchFailedCount: null,
        blockFetchEndpoint: null,
      };

      const { service, saveSpy } = makeService({
        pieceResult: okPiece(Buffer.from("not-a-car")),
        piece: INDEXED_PIECE,
        carResult,
      });

      await service.performForProvider(SP_ADDRESS);

      const entity = saveSpy.mock.calls[0]?.[0] as AnonRetrieval;
      expect(entity.carParseable).toBe(false);
      // car_block_count and block_fetch_sampled_count are gated on carParseable
      // so an unparseable CAR doesn't emit a misleading 0.
      expect(entity.carBlockCount).toBeNull();
      expect(entity.blockFetchSampledCount).toBeNull();
      expect(entity.blockFetchEndpoint).toBeNull();
      expect(entity.blockFetchValid).toBeNull();
      expect(entity.blockFetchFailedCount).toBeNull();
      expect(entity.ipniStatus).toBe(IpniCheckStatus.SKIPPED);
      expect(entity.ipniVerifyMs).toBeNull();
      expect(entity.ipniVerifiedCidsCount).toBeNull();
      expect(entity.ipniUnverifiedCidsCount).toBeNull();
    });
  });
});
