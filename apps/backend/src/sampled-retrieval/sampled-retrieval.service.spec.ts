import type { ConfigService } from "@nestjs/config";
import type { Repository } from "typeorm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClickhouseService } from "../clickhouse/clickhouse.service.js";
import { PieceFetchStatus } from "../clickhouse/clickhouse.types.js";
import type { IConfig } from "../config/app.config.js";
import type { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { BlockFetchStatus, CarParseStatus, IpniCheckStatus, RetrievalStatus } from "../database/types.js";
import type { SampledRetrievalCheckMetrics } from "../metrics-prometheus/check-metrics.service.js";
import type { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import type { PieceRetrievalService } from "./piece-retrieval.service.js";
import type { PieceValidationService } from "./piece-validation.service.js";
import type { SampledPieceSelectorService } from "./sampled-piece-selector.service.js";
import { SampledRetrievalService } from "./sampled-retrieval.service.js";
import type {
  BlockFetchOutcome,
  CarParseOutcome,
  IpniCheckOutcome,
  PieceRetrievalResult,
  SampledBlock,
  SampledPiece,
} from "./types.js";

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

const SAMPLED_BLOCKS = [] as SampledBlock[];

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
  piece?: SampledPiece | null;
  parseCarOutcome?: CarParseOutcome;
  parseCarImpl?: (bytes: Buffer, signal?: AbortSignal) => Promise<CarParseOutcome>;
  checkIpniOutcome?: IpniCheckOutcome;
  checkIpniImpl?: () => Promise<IpniCheckOutcome>;
  checkBlockFetchOutcome?: BlockFetchOutcome;
  checkBlockFetchImpl?: () => Promise<BlockFetchOutcome>;
}): {
  service: SampledRetrievalService;
  insertSpy: ReturnType<typeof vi.fn>;
  findOneSpy: ReturnType<typeof vi.fn>;
  fetchSpy: ReturnType<typeof vi.fn>;
  parseCarSpy: ReturnType<typeof vi.fn>;
  checkIpniSpy: ReturnType<typeof vi.fn>;
  checkBlockFetchSpy: ReturnType<typeof vi.fn>;
  metricsRecordStatusSpy: ReturnType<typeof vi.fn>;
  metricsRecordCarParseSpy: ReturnType<typeof vi.fn>;
  metricsRecordIpniSpy: ReturnType<typeof vi.fn>;
  metricsRecordBlockFetchSpy: ReturnType<typeof vi.fn>;
} {
  const insertSpy = vi.fn();
  const clickhouseService = {
    insert: insertSpy,
    enabled: true,
    probeLocation: "test-location",
  } as unknown as ClickhouseService;

  const findOneSpy = vi.fn(async () => makeProvider());
  const spRepository = {
    findOne: findOneSpy,
  } as unknown as Repository<StorageProvider>;

  const sampledPieceSelector = {
    selectPieceForProvider: vi.fn(async () => (opts.piece === null ? null : (opts.piece ?? PIECE))),
  } as unknown as SampledPieceSelectorService;

  const fetchSpy = vi.fn(opts.fetchPieceImpl ?? (async () => opts.pieceResult));
  const pieceRetrievalService = {
    fetchPiece: fetchSpy,
  } as unknown as PieceRetrievalService;

  const parseCarSpy = vi.fn(
    opts.parseCarImpl ??
      (async () =>
        opts.parseCarOutcome ?? {
          status: CarParseStatus.SUCCESS,
          blockCount: 0,
          sampledBlocks: SAMPLED_BLOCKS,
        }),
  );
  const checkIpniSpy = vi.fn(
    opts.checkIpniImpl ?? (async () => opts.checkIpniOutcome ?? { status: IpniCheckStatus.SUCCESS, durationMs: 0 }),
  );
  const checkBlockFetchSpy = vi.fn(
    opts.checkBlockFetchImpl ??
      (async () =>
        opts.checkBlockFetchOutcome ?? {
          status: IpniCheckStatus.SUCCESS,
          sampledCount: 0,
          failedCount: 0,
          endpoint: "https://sp.test/ipfs/",
        }),
  );
  const pieceValidationService = {
    parseCar: parseCarSpy,
    checkIpni: checkIpniSpy,
    checkBlockFetch: checkBlockFetchSpy,
  } as unknown as PieceValidationService;

  const walletSdkService = {
    getProviderInfo: vi.fn(() => ({ pdp: { serviceURL: "https://sp.test/" } })),
  } as unknown as WalletSdkService;

  const metricsRecordStatusSpy = vi.fn();
  const metricsRecordCarParseSpy = vi.fn();
  const metricsRecordIpniSpy = vi.fn();
  const metricsRecordBlockFetchSpy = vi.fn();
  const metrics = {
    observeFirstByteMs: vi.fn(),
    observeLastByteMs: vi.fn(),
    observeThroughput: vi.fn(),
    observeCheckDuration: vi.fn(),
    recordPieceRetrievalStatus: metricsRecordStatusSpy,
    recordHttpResponseCode: vi.fn(),
    recordCarParseStatus: metricsRecordCarParseSpy,
    recordIpniStatus: metricsRecordIpniSpy,
    recordBlockFetchStatus: metricsRecordBlockFetchSpy,
  } as unknown as SampledRetrievalCheckMetrics;

  const configService = {
    get: vi.fn(() => ({ network: "calibration" })),
  } as unknown as ConfigService<IConfig, true>;

  const service = new SampledRetrievalService(
    sampledPieceSelector,
    pieceRetrievalService,
    pieceValidationService,
    walletSdkService,
    metrics,
    clickhouseService,
    spRepository,
    configService,
  );

  return {
    service,
    insertSpy,
    findOneSpy,
    fetchSpy,
    parseCarSpy,
    checkIpniSpy,
    checkBlockFetchSpy,
    metricsRecordStatusSpy,
    metricsRecordCarParseSpy,
    metricsRecordIpniSpy,
    metricsRecordBlockFetchSpy,
  };
}

describe("SampledRetrievalService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("looks up the storage provider scoped to the configured network", async () => {
    const { service, findOneSpy } = makeService({
      pieceResult: {
        success: true,
        pieceCid: PIECE.pieceCid,
        bytesReceived: 1024,
        pieceBytes: null,
        latencyMs: 10,
        ttfbMs: 5,
        throughputBps: 100,
        statusCode: 200,
        httpSuccess: true,
        commPValid: true,
        aborted: false,
      },
    });

    await service.performForProvider(SP_ADDRESS);

    expect(findOneSpy).toHaveBeenCalledWith({ where: { address: SP_ADDRESS, network: "calibration" } });
  });

  it("tags sampled retrieval metrics with the configured network", async () => {
    const { service, metricsRecordStatusSpy } = makeService({
      pieceResult: {
        success: true,
        pieceCid: PIECE.pieceCid,
        bytesReceived: 1024,
        pieceBytes: null,
        latencyMs: 10,
        ttfbMs: 5,
        throughputBps: 100,
        statusCode: 200,
        httpSuccess: true,
        commPValid: true,
        aborted: false,
      },
    });

    await service.performForProvider(SP_ADDRESS);

    expect(metricsRecordStatusSpy).toHaveBeenCalledWith(
      expect.objectContaining({ checkType: "sampledRetrieval", network: "calibration" }),
      expect.anything(),
    );
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
      httpSuccess: false,
      commPValid: false,
      errorMessage: "Sampled retrieval job timeout (60s) for sp1",
      aborted: true,
    };

    const { service, insertSpy } = makeService({ pieceResult: partial });

    await service.performForProvider(SP_ADDRESS);

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const [table, row] = insertSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(table).toBe("sampled_retrieval_checks");
    expect(row.piece_fetch_status).toBe(PieceFetchStatus.FAILED);
    expect(row.bytes_retrieved).toBe(524288);
    expect(row.first_byte_ms).toBe(150);
    expect(row.last_byte_ms).toBe(42000);
    expect(row.http_response_code).toBe(200);
    expect(row.error_message).toContain("Sampled retrieval job timeout");
    expect(row.piece_cid).toBe(PIECE.pieceCid);
    expect(row.sp_address).toBe(SP_ADDRESS);
    expect(row.sp_id).toBe(7);
    expect(row.probe_location).toBe("test-location");
    expect(typeof row.retrieval_id).toBe("string");

    // CAR/IPNI/block-fetch were never run on a non-IPFS-indexed piece — every
    // dimension status should explicitly say "skipped".
    expect(row.car_status).toBe("skipped");
    expect(row.car_block_count).toBeNull();
    expect(row.block_fetch_endpoint).toBeNull();
    expect(row.block_fetch_status).toBe("skipped");
    expect(row.block_fetch_sampled_count).toBeNull();
    expect(row.block_fetch_failed_count).toBeNull();
    expect(row.ipni_status).toBe("skipped");
    expect(row.ipni_verify_ms).toBeNull();
  });

  it("maps a too-large piece fetch to failure.too_large and skips downstream dimensions", async () => {
    // fetchPiece aborts the download once it exceeds the enforced ceiling and
    // returns tooLarge=true. The bytes were discarded, so CAR/IPNI/block-fetch
    // never run, and the status must be distinct from a timeout or plain HTTP fail.
    const tooLarge: PieceRetrievalResult = {
      success: false,
      pieceCid: PIECE.pieceCid,
      bytesReceived: 209715201,
      pieceBytes: null,
      latencyMs: 5000,
      ttfbMs: 30,
      throughputBps: 41943040,
      statusCode: 200,
      httpSuccess: false,
      commPValid: false,
      errorMessage: "Piece exceeded max download size of 209715200 bytes",
      tooLarge: true,
    };

    const { service, insertSpy, parseCarSpy, metricsRecordStatusSpy } = makeService({ pieceResult: tooLarge });

    await service.performForProvider(SP_ADDRESS);

    expect(parseCarSpy).not.toHaveBeenCalled();
    expect(metricsRecordStatusSpy).toHaveBeenCalledWith(expect.anything(), "failure.too_large");

    const [, row] = insertSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(row.piece_fetch_status).toBe(RetrievalStatus.FAILED);
    expect(row.bytes_retrieved).toBe(209715201);
    expect(row.error_message).toContain("exceeded max download size");
    expect(row.commp_valid).toBeNull();
    expect(row.car_status).toBe("skipped");
  });

  it("still emits a row when the signal aborts before fetchPiece runs", async () => {
    const ac = new AbortController();
    ac.abort(new Error("Sampled retrieval job timeout (60s) for sp1"));

    const never: PieceRetrievalResult = {
      success: false,
      pieceCid: PIECE.pieceCid,
      bytesReceived: 0,
      pieceBytes: null,
      latencyMs: 0,
      ttfbMs: 0,
      throughputBps: 0,
      statusCode: 0,
      httpSuccess: false,
      commPValid: false,
    };

    const { service, insertSpy, fetchSpy } = makeService({ pieceResult: never });

    await service.performForProvider(SP_ADDRESS, ac.signal);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const [, row] = insertSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(row.piece_fetch_status).toBe(PieceFetchStatus.FAILED);
    expect(row.error_message).toContain("Sampled retrieval job timeout");
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
      httpSuccess: false,
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
    expect(row.piece_fetch_status).toBe(PieceFetchStatus.FAILED);
  });

  it("records a skipped check instead of throwing when no candidate piece is found", async () => {
    const never: PieceRetrievalResult = {
      success: false,
      pieceCid: "",
      bytesReceived: 0,
      pieceBytes: null,
      latencyMs: 0,
      ttfbMs: 0,
      throughputBps: 0,
      statusCode: 0,
      httpSuccess: false,
      commPValid: false,
    };

    const { service, insertSpy, fetchSpy, metricsRecordStatusSpy } = makeService({
      pieceResult: never,
      piece: null,
    });

    await expect(service.performForProvider(SP_ADDRESS)).resolves.toBeUndefined();

    // No piece was selected, so no fetch was attempted; only the overall
    // piece-retrieval status metric is emitted, valued "skipped".
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(metricsRecordStatusSpy).toHaveBeenCalledWith(expect.anything(), "skipped");

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const [table, row] = insertSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(table).toBe("sampled_retrieval_checks");
    expect(row.piece_fetch_status).toBe(PieceFetchStatus.SKIPPED);
    expect(row.car_status).toBe("skipped");
    expect(row.ipni_status).toBe("skipped");
    expect(row.block_fetch_status).toBe("skipped");
    // No piece → identity columns carry sentinels and perf columns are null.
    expect(row.piece_cid).toBe("");
    expect(row.data_set_id).toBe(0);
    expect(row.piece_id).toBe(0);
    expect(row.raw_size).toBe(0);
    expect(row.with_ipfs_indexing).toBe(false);
    expect(row.http_response_code).toBeNull();
    expect(row.bytes_retrieved).toBeNull();
    expect(row.sp_address).toBe(SP_ADDRESS);
    expect(row.sp_id).toBe(7);
    expect(row.error_message).toContain("No candidate piece found");
  });

  it("throws (preserving abort semantics) when selection returns null due to an aborted signal", async () => {
    const ac = new AbortController();
    ac.abort(new Error("Sampled retrieval job timeout (60s) for sp1"));

    const never: PieceRetrievalResult = {
      success: false,
      pieceCid: "",
      bytesReceived: 0,
      pieceBytes: null,
      latencyMs: 0,
      ttfbMs: 0,
      throughputBps: 0,
      statusCode: 0,
      httpSuccess: false,
      commPValid: false,
    };

    const { service, insertSpy, metricsRecordStatusSpy } = makeService({
      pieceResult: never,
      piece: null,
    });

    await expect(service.performForProvider(SP_ADDRESS, ac.signal)).rejects.toThrow("aborted during piece selection");

    // An abort is not an empty-pool skip: no check row, no skipped metric — the
    // job handler maps the aborted signal to "aborted" rather than a failure.
    expect(insertSpy).not.toHaveBeenCalled();
    expect(metricsRecordStatusSpy).not.toHaveBeenCalled();
  });

  describe("with IPFS indexing", () => {
    const INDEXED_PIECE: SampledPiece = {
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
        httpSuccess: true,
        commPValid: true,
      };
    }

    it("emits populated CAR/IPNI/block-fetch columns when validation fully succeeds", async () => {
      const { service, insertSpy, parseCarSpy, checkIpniSpy, checkBlockFetchSpy } = makeService({
        pieceResult: okPiece(Buffer.from("car-bytes")),
        piece: INDEXED_PIECE,
        parseCarOutcome: { status: CarParseStatus.SUCCESS, blockCount: 42, sampledBlocks: SAMPLED_BLOCKS },
        checkIpniOutcome: { status: IpniCheckStatus.SUCCESS, durationMs: 137 },
        checkBlockFetchOutcome: {
          status: BlockFetchStatus.SUCCESS,
          sampledCount: 5,
          failedCount: 0,
          endpoint: "https://sp.test/ipfs/",
        },
      });

      await service.performForProvider(SP_ADDRESS);

      expect(parseCarSpy).toHaveBeenCalledTimes(1);
      expect(checkIpniSpy).toHaveBeenCalledTimes(1);
      expect(checkBlockFetchSpy).toHaveBeenCalledTimes(1);
      const [, row] = insertSpy.mock.calls[0] as [string, Record<string, unknown>];
      expect(row.piece_fetch_status).toBe(PieceFetchStatus.SUCCESS);
      expect(row.commp_valid).toBe(true);
      expect(row.car_status).toBe("success");
      expect(row.car_block_count).toBe(42);
      expect(row.block_fetch_endpoint).toBe("https://sp.test/ipfs/");
      expect(row.block_fetch_status).toBe("success");
      expect(row.block_fetch_sampled_count).toBe(5);
      expect(row.block_fetch_failed_count).toBe(0);
      expect(row.ipni_status).toBe("success");
      expect(row.ipni_verify_ms).toBe(137);
    });

    it("distinguishes IPNI failure.timedout from block-fetch failure.other", async () => {
      const { service, insertSpy } = makeService({
        pieceResult: okPiece(Buffer.from("car-bytes")),
        piece: INDEXED_PIECE,
        parseCarOutcome: { status: CarParseStatus.SUCCESS, blockCount: 100, sampledBlocks: SAMPLED_BLOCKS },
        checkIpniOutcome: { status: IpniCheckStatus.FAILURE_TIMEDOUT, durationMs: 250 },
        checkBlockFetchOutcome: {
          status: BlockFetchStatus.FAILURE_OTHER,
          sampledCount: 5,
          failedCount: 2,
          endpoint: "https://sp.test/ipfs/",
        },
      });

      await service.performForProvider(SP_ADDRESS);

      const [, row] = insertSpy.mock.calls[0] as [string, Record<string, unknown>];
      // The piece-fetch path still succeeded — failures are surfaced as
      // independent dimensions, not folded into piece_fetch_status.
      expect(row.piece_fetch_status).toBe(PieceFetchStatus.SUCCESS);
      expect(row.car_status).toBe("success");
      expect(row.ipni_status).toBe("failure.timedout");
      expect(row.block_fetch_status).toBe("failure.other");
      expect(row.block_fetch_sampled_count).toBe(5);
      expect(row.block_fetch_failed_count).toBe(2);
    });

    it("skips downstream dimensions when parseCar returns failure.not_parseable", async () => {
      // The decoupled service guarantees that an unparseable CAR never even
      // attempts IPNI or block fetch — there are no CIDs to verify or fetch.
      const { service, insertSpy, parseCarSpy, checkIpniSpy, checkBlockFetchSpy } = makeService({
        pieceResult: okPiece(Buffer.from("not-a-car")),
        piece: INDEXED_PIECE,
        parseCarOutcome: { status: CarParseStatus.FAILURE_NOT_PARSEABLE },
      });

      await service.performForProvider(SP_ADDRESS);

      expect(parseCarSpy).toHaveBeenCalledTimes(1);
      expect(checkIpniSpy).not.toHaveBeenCalled();
      expect(checkBlockFetchSpy).not.toHaveBeenCalled();

      const [, row] = insertSpy.mock.calls[0] as [string, Record<string, unknown>];
      expect(row.car_status).toBe("failure.not_parseable");
      expect(row.car_block_count).toBeNull();
      expect(row.block_fetch_sampled_count).toBeNull();
      expect(row.block_fetch_endpoint).toBeNull();
      expect(row.block_fetch_status).toBe("skipped");
      expect(row.block_fetch_failed_count).toBeNull();
      expect(row.ipni_status).toBe("skipped");
      expect(row.ipni_verify_ms).toBeNull();
    });

    it("propagates checkIpni's SKIPPED status to the row (root CID unparseable)", async () => {
      // Previously this case was bucketed as INVALID, which misattributed a
      // client-side data problem (bad root CID from the subgraph) to the SP.
      const { service, insertSpy, metricsRecordIpniSpy } = makeService({
        pieceResult: okPiece(Buffer.from("car-bytes")),
        piece: INDEXED_PIECE,
        parseCarOutcome: { status: CarParseStatus.SUCCESS, blockCount: 1, sampledBlocks: SAMPLED_BLOCKS },
        checkIpniOutcome: { status: IpniCheckStatus.SKIPPED, durationMs: null },
        checkBlockFetchOutcome: {
          status: BlockFetchStatus.SUCCESS,
          sampledCount: 1,
          failedCount: 0,
          endpoint: "https://sp.test/ipfs/",
        },
      });

      await service.performForProvider(SP_ADDRESS);

      expect(metricsRecordIpniSpy).toHaveBeenCalledWith(expect.anything(), IpniCheckStatus.SKIPPED);
      const [, row] = insertSpy.mock.calls[0] as [string, Record<string, unknown>];
      expect(row.ipni_status).toBe("skipped");
      // car_status / block_fetch_status remain whatever their own steps returned.
      expect(row.car_status).toBe("success");
      expect(row.block_fetch_status).toBe("success");
    });

    it("propagates checkIpni's failure.other status only to ipni_status (not other dimensions)", async () => {
      // The whole point of decoupling: an unexpected throw in IPNI verification
      // cannot bleed into car_status or block_fetch_status.
      const { service, insertSpy, metricsRecordIpniSpy, metricsRecordCarParseSpy, metricsRecordBlockFetchSpy } =
        makeService({
          pieceResult: okPiece(Buffer.from("car-bytes")),
          piece: INDEXED_PIECE,
          parseCarOutcome: { status: CarParseStatus.SUCCESS, blockCount: 1, sampledBlocks: SAMPLED_BLOCKS },
          checkIpniOutcome: { status: IpniCheckStatus.FAILURE_OTHER, durationMs: null },
          checkBlockFetchOutcome: {
            status: BlockFetchStatus.SUCCESS,
            sampledCount: 1,
            failedCount: 0,
            endpoint: "https://sp.test/ipfs/",
          },
        });

      await service.performForProvider(SP_ADDRESS);

      expect(metricsRecordCarParseSpy).toHaveBeenCalledWith(expect.anything(), CarParseStatus.SUCCESS);
      expect(metricsRecordIpniSpy).toHaveBeenCalledWith(expect.anything(), IpniCheckStatus.FAILURE_OTHER);
      expect(metricsRecordBlockFetchSpy).toHaveBeenCalledWith(expect.anything(), BlockFetchStatus.SUCCESS);

      const [, row] = insertSpy.mock.calls[0] as [string, Record<string, unknown>];
      expect(row.car_status).toBe("success");
      expect(row.ipni_status).toBe("failure.other");
      expect(row.block_fetch_status).toBe("success");
    });

    it("propagates checkBlockFetch's SKIPPED status (SP info missing) without affecting other dimensions", async () => {
      const { service, insertSpy } = makeService({
        pieceResult: okPiece(Buffer.from("car-bytes")),
        piece: INDEXED_PIECE,
        parseCarOutcome: { status: CarParseStatus.SUCCESS, blockCount: 1, sampledBlocks: SAMPLED_BLOCKS },
        checkIpniOutcome: { status: IpniCheckStatus.SUCCESS, durationMs: 50 },
        checkBlockFetchOutcome: {
          status: BlockFetchStatus.SKIPPED,
          sampledCount: 1,
          failedCount: null,
          endpoint: null,
          errorMessage: "Provider info not found",
        },
      });

      await service.performForProvider(SP_ADDRESS);

      const [, row] = insertSpy.mock.calls[0] as [string, Record<string, unknown>];
      expect(row.car_status).toBe("success");
      expect(row.ipni_status).toBe("success");
      expect(row.block_fetch_status).toBe("skipped");
      expect(row.block_fetch_endpoint).toBeNull();
      expect(row.block_fetch_failed_count).toBeNull();
    });

    it("marks every dimension SKIPPED when the signal aborts during parseCar", async () => {
      // Operator-driven aborts must never charge an SP-fault bucket. The
      // service propagates the abort; orchestrator's helpers default to SKIPPED.
      const ac = new AbortController();
      const { service, insertSpy, metricsRecordCarParseSpy, metricsRecordIpniSpy, metricsRecordBlockFetchSpy } =
        makeService({
          pieceResult: okPiece(Buffer.from("car-bytes")),
          piece: INDEXED_PIECE,
          parseCarImpl: async () => {
            ac.abort(new Error("Sampled retrieval job timeout"));
            throw Object.assign(new Error("aborted"), { name: "AbortError" });
          },
        });

      await service.performForProvider(SP_ADDRESS, ac.signal);

      expect(metricsRecordCarParseSpy).toHaveBeenCalledWith(expect.anything(), CarParseStatus.SKIPPED);
      expect(metricsRecordIpniSpy).toHaveBeenCalledWith(expect.anything(), IpniCheckStatus.SKIPPED);
      expect(metricsRecordBlockFetchSpy).toHaveBeenCalledWith(expect.anything(), IpniCheckStatus.SKIPPED);

      const [, row] = insertSpy.mock.calls[0] as [string, Record<string, unknown>];
      expect(row.car_status).toBe("skipped");
      expect(row.ipni_status).toBe("skipped");
      expect(row.block_fetch_status).toBe("skipped");
    });

    it("skips CAR/IPNI/block-fetch when SP returns 2xx with wrong bytes (commPValid=false)", async () => {
      // fetchPiece flips success=false on a commP mismatch (a 2xx response with
      // the wrong bytes is a retrieval failure, not a success). Downstream
      // parsing/IPNI/block-fetch must therefore be skipped, and the overall
      // status must surface as failure.commp — distinguished from failure.http
      // by the still-2xx statusCode.
      const wrongBytes: PieceRetrievalResult = {
        success: false,
        pieceCid: INDEXED_PIECE.pieceCid,
        bytesReceived: 1024,
        pieceBytes: Buffer.from("garbage-bytes"),
        latencyMs: 200,
        ttfbMs: 20,
        throughputBps: 51200,
        statusCode: 200,
        httpSuccess: true,
        commPValid: false,
        errorMessage: `CommP mismatch: bytes do not match ${INDEXED_PIECE.pieceCid}`,
      };

      const {
        service,
        insertSpy,
        parseCarSpy,
        checkIpniSpy,
        checkBlockFetchSpy,
        metricsRecordStatusSpy,
        metricsRecordCarParseSpy,
        metricsRecordIpniSpy,
        metricsRecordBlockFetchSpy,
      } = makeService({
        pieceResult: wrongBytes,
        piece: INDEXED_PIECE,
      });

      await service.performForProvider(SP_ADDRESS);

      expect(parseCarSpy).not.toHaveBeenCalled();
      expect(checkIpniSpy).not.toHaveBeenCalled();
      expect(checkBlockFetchSpy).not.toHaveBeenCalled();
      expect(metricsRecordCarParseSpy).toHaveBeenCalledWith(expect.anything(), CarParseStatus.SKIPPED);
      expect(metricsRecordIpniSpy).toHaveBeenCalledWith(expect.anything(), IpniCheckStatus.SKIPPED);
      expect(metricsRecordBlockFetchSpy).toHaveBeenCalledWith(expect.anything(), IpniCheckStatus.SKIPPED);
      expect(metricsRecordStatusSpy).toHaveBeenCalledWith(expect.anything(), "failure.commp");

      const [, row] = insertSpy.mock.calls[0] as [string, Record<string, unknown>];
      expect(row.piece_fetch_status).toBe(PieceFetchStatus.FAILED);
      expect(row.commp_valid).toBe(false);
      expect(row.car_status).toBe("skipped");
      expect(row.ipni_status).toBe("skipped");
      expect(row.block_fetch_status).toBe("skipped");
    });
  });
});
