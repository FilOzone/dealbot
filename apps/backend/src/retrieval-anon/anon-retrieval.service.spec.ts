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
    providerId: 7,
    name: "sp-test",
    isApproved: true,
  } as unknown as StorageProvider;
}

function makeService(opts: {
  pieceResult: PieceRetrievalResult;
  fetchPieceImpl?: (signal?: AbortSignal) => Promise<PieceRetrievalResult>;
  piece?: AnonPiece | null;
  carResult?: CarValidationResult;
  validateCarImpl?: () => Promise<CarValidationResult>;
}): {
  service: AnonRetrievalService;
  insertSpy: ReturnType<typeof vi.fn>;
  fetchSpy: ReturnType<typeof vi.fn>;
  validateCarSpy: ReturnType<typeof vi.fn>;
  metricsRecordStatusSpy: ReturnType<typeof vi.fn>;
  metricsRecordIpniSpy: ReturnType<typeof vi.fn>;
  metricsRecordBlockFetchSpy: ReturnType<typeof vi.fn>;
} {
  const insertSpy = vi.fn();
  const clickhouseService = {
    insert: insertSpy,
    enabled: true,
    probeLocation: "test-location",
  } as unknown as ClickhouseService;

  const spRepository = {
    findOne: vi.fn(async () => makeProvider()),
  } as unknown as Repository<StorageProvider>;

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
  );

  return {
    service,
    insertSpy,
    fetchSpy,
    validateCarSpy,
    metricsRecordStatusSpy,
    metricsRecordIpniSpy,
    metricsRecordBlockFetchSpy,
  };
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
    expect(row.piece_fetch_status).toBe(RetrievalStatus.FAILED);
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

    // CAR/IPNI/block-fetch were never run on a non-IPFS-indexed piece — every
    // dimension column should explicitly say "skipped" (ipni_status) or null.
    expect(row.car_parseable).toBeNull();
    expect(row.car_block_count).toBeNull();
    expect(row.block_fetch_endpoint).toBeNull();
    expect(row.block_fetch_valid).toBeNull();
    expect(row.block_fetch_sampled_count).toBeNull();
    expect(row.block_fetch_failed_count).toBeNull();
    expect(row.ipni_status).toBe("skipped");
    expect(row.ipni_verify_ms).toBeNull();
    expect(row.ipni_verified_cids_count).toBeNull();
    expect(row.ipni_unverified_cids_count).toBeNull();
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
    expect(row.piece_fetch_status).toBe(RetrievalStatus.FAILED);
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
    expect(row.piece_fetch_status).toBe(RetrievalStatus.FAILED);
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

    it("emits populated CAR/IPNI/block-fetch columns when validation fully succeeds", async () => {
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

      const { service, insertSpy, validateCarSpy } = makeService({
        pieceResult: okPiece(Buffer.from("car-bytes")),
        piece: INDEXED_PIECE,
        carResult,
      });

      await service.performForProvider(SP_ADDRESS);

      expect(validateCarSpy).toHaveBeenCalledTimes(1);
      const [, row] = insertSpy.mock.calls[0] as [string, Record<string, unknown>];
      expect(row.piece_fetch_status).toBe(RetrievalStatus.SUCCESS);
      expect(row.commp_valid).toBe(true);
      expect(row.car_parseable).toBe(true);
      expect(row.car_block_count).toBe(42);
      expect(row.block_fetch_endpoint).toBe("https://sp.test/ipfs/");
      expect(row.block_fetch_valid).toBe(true);
      expect(row.block_fetch_sampled_count).toBe(5);
      expect(row.block_fetch_failed_count).toBe(0);
      expect(row.ipni_status).toBe("valid");
      expect(row.ipni_verify_ms).toBe(137);
      expect(row.ipni_verified_cids_count).toBe(6);
      expect(row.ipni_unverified_cids_count).toBe(0);
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

      const { service, insertSpy } = makeService({
        pieceResult: okPiece(Buffer.from("car-bytes")),
        piece: INDEXED_PIECE,
        carResult,
      });

      await service.performForProvider(SP_ADDRESS);

      const [, row] = insertSpy.mock.calls[0] as [string, Record<string, unknown>];
      // The piece-fetch path still succeeded — failures are surfaced as
      // independent dimensions, not folded into piece_fetch_status.
      expect(row.piece_fetch_status).toBe(RetrievalStatus.SUCCESS);
      expect(row.car_parseable).toBe(true);
      expect(row.ipni_status).toBe("invalid");
      expect(row.ipni_verified_cids_count).toBe(0);
      expect(row.ipni_unverified_cids_count).toBe(6);
      expect(row.block_fetch_valid).toBe(false);
      expect(row.block_fetch_sampled_count).toBe(5);
      expect(row.block_fetch_failed_count).toBe(2);
    });

    it("emits ipni_status='error' (not 'skipped') when CAR validation throws on a successful piece", async () => {
      // Distinguishes a real infra outage (e.g. IpniVerificationService down)
      // from a piece that legitimately had no IPFS indexing. Without the
      // distinction, an outage looks like normal non-IPFS volume in dashboards.
      const { service, insertSpy, metricsRecordIpniSpy, metricsRecordBlockFetchSpy } = makeService({
        pieceResult: okPiece(Buffer.from("car-bytes")),
        piece: INDEXED_PIECE,
        validateCarImpl: async () => {
          throw new Error("IpniVerificationService down");
        },
      });

      await service.performForProvider(SP_ADDRESS);

      expect(metricsRecordIpniSpy).toHaveBeenCalledWith(expect.anything(), "error");
      expect(metricsRecordBlockFetchSpy).toHaveBeenCalledWith(expect.anything(), "error");

      const [, row] = insertSpy.mock.calls[0] as [string, Record<string, unknown>];
      expect(row.ipni_status).toBe("error");
      // Piece-fetch path itself succeeded — only the validation pipeline failed.
      expect(row.commp_valid).toBe(true);
      expect(row.car_parseable).toBeNull();
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

      const { service, insertSpy } = makeService({
        pieceResult: okPiece(Buffer.from("not-a-car")),
        piece: INDEXED_PIECE,
        carResult,
      });

      await service.performForProvider(SP_ADDRESS);

      const [, row] = insertSpy.mock.calls[0] as [string, Record<string, unknown>];
      expect(row.car_parseable).toBe(false);
      // car_block_count and block_fetch_sampled_count are gated on carParseable
      // so an unparseable CAR doesn't emit a misleading 0.
      expect(row.car_block_count).toBeNull();
      expect(row.block_fetch_sampled_count).toBeNull();
      expect(row.block_fetch_endpoint).toBeNull();
      expect(row.block_fetch_valid).toBeNull();
      expect(row.block_fetch_failed_count).toBeNull();
      expect(row.ipni_status).toBe("skipped");
      expect(row.ipni_verify_ms).toBeNull();
      expect(row.ipni_verified_cids_count).toBeNull();
      expect(row.ipni_unverified_cids_count).toBeNull();
    });
  });
});
