import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { ClickhouseService } from "../clickhouse/clickhouse.service.js";
import { type ProviderJobContext, toStructuredError } from "../common/logging.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { BlockFetchStatus, CarParseStatus, IpniCheckStatus, RetrievalStatus, ServiceType } from "../database/types.js";
import { buildCheckMetricLabels } from "../metrics-prometheus/check-metric-labels.js";
import { SampledRetrievalCheckMetrics } from "../metrics-prometheus/check-metrics.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { PieceRetrievalService } from "./piece-retrieval.service.js";
import { PieceValidationService } from "./piece-validation.service.js";
import { SampledPieceSelectorService } from "./sampled-piece-selector.service.js";
import type { BlockFetchOutcome, CarParseOutcome, IpniCheckOutcome, PieceRetrievalResult } from "./types.js";

const SAMPLED_RETRIEVAL_CHECKS_TABLE = "sampled_retrieval_checks";

@Injectable()
export class SampledRetrievalService {
  private readonly logger = new Logger(SampledRetrievalService.name);

  constructor(
    private readonly sampledPieceSelectorService: SampledPieceSelectorService,
    private readonly pieceRetrievalService: PieceRetrievalService,
    private readonly pieceValidationService: PieceValidationService,
    private readonly walletSdkService: WalletSdkService,
    private readonly metrics: SampledRetrievalCheckMetrics,
    private readonly clickhouseService: ClickhouseService,
    @InjectRepository(StorageProvider)
    private readonly spRepository: Repository<StorageProvider>,
  ) {}

  async performForProvider(spAddress: string, signal?: AbortSignal, logContext?: ProviderJobContext): Promise<void> {
    // Build metric labels
    const provider = await this.spRepository.findOne({ where: { address: spAddress } });
    const labels = buildCheckMetricLabels({
      checkType: "sampledRetrieval",
      providerId: provider?.providerId,
      providerName: provider?.name,
      providerIsApproved: provider?.isApproved,
    });

    // 1. Select an anonymous piece
    const piece = await this.sampledPieceSelectorService.selectPieceForProvider(spAddress, signal);
    if (!piece) {
      throw new Error(`No anonymous piece found for SP ${spAddress}`);
    }

    this.logger.log({
      ...logContext,
      event: "sampled_retrieval_started",
      message: "Starting anonymous retrieval test",
      pieceCid: piece.pieceCid,
      dataSetId: piece.dataSetId,
      pieceId: piece.pieceId,
      withIPFSIndexing: piece.withIPFSIndexing,
      spAddress,
    });

    const checkStart = Date.now();
    const startedAt = new Date();

    let pieceResult: PieceRetrievalResult | null = null;
    let parse: CarParseOutcome | null = null;
    let ipni: IpniCheckOutcome | null = null;
    let blockFetch: BlockFetchOutcome | null = null;

    try {
      // 2. Fetch the piece. fetchPiece never throws on abort — it returns a
      // result with partial metrics so we can persist what we have.
      if (signal?.aborted) {
        pieceResult = buildAbortedPlaceholder(piece.pieceCid, signal.reason);
      } else {
        pieceResult = await this.pieceRetrievalService.fetchPiece(spAddress, piece.pieceCid, signal);
      }

      // Emit piece retrieval metrics
      this.metrics.observeFirstByteMs(labels, pieceResult.ttfbMs);
      this.metrics.observeLastByteMs(labels, pieceResult.latencyMs);
      this.metrics.observeThroughput(labels, pieceResult.throughputBps);
      this.metrics.recordHttpResponseCode(labels, pieceResult.statusCode);

      // 3. CAR / IPNI / block-fetch validation (only when piece was successfully
      // retrieved, advertises IPFS indexing, and the job hasn't been cancelled).
      // Each dimension is computed independently
      if (
        pieceResult.success &&
        piece.withIPFSIndexing &&
        piece.ipfsRootCid &&
        pieceResult.pieceBytes &&
        provider &&
        !signal?.aborted
      ) {
        try {
          parse = await this.pieceValidationService.parseCar(pieceResult.pieceBytes, signal);

          if (parse.status === CarParseStatus.SUCCESS) {
            ipni = await this.pieceValidationService.checkIpni(
              provider,
              piece.ipfsRootCid,
              parse.sampledBlocks,
              signal,
            );
            blockFetch = await this.pieceValidationService.checkBlockFetch(parse.sampledBlocks, spAddress, signal);
          }
        } catch (error) {
          // pieceValidationService methods only throw on abort (via signal.throwIfAborted in
          // their catch blocks). Operator-driven cancellation must not bubble
          // out of performForProvider — the finally block still emits the row,
          // and the status helpers default whatever didn't run to SKIPPED.
          // Anything else is a genuine bug and is re-thrown.
          if (!signal?.aborted) throw error;
        }
      }

      const carStatus = carStatusForRow(parse);
      const ipniStatus = ipniStatusForRow(parse, ipni);
      const blockFetchStatus = blockFetchStatusForRow(parse, blockFetch);

      this.metrics.recordCarParseStatus(labels, carStatus);
      this.metrics.recordIpniStatus(labels, ipniStatus);
      this.metrics.recordBlockFetchStatus(labels, blockFetchStatus);
      this.metrics.observeCheckDuration(labels, Date.now() - checkStart);
      this.metrics.recordPieceRetrievalStatus(labels, sampledPieceRetrievalStatus(pieceResult));
    } finally {
      // Always emit a ClickHouse row — even on abort or unexpected error — so
      // we never lose the evidence (ttfb, bytes, response code) we already
      // collected. ClickhouseService.insert is a no-op when disabled.
      const finalPieceResult = pieceResult ?? buildAbortedPlaceholder(piece.pieceCid, signal?.reason);
      const retrievalId = randomUUID();
      const providerInfo = this.walletSdkService.getProviderInfo(spAddress);
      const spBaseUrl = providerInfo?.pdp.serviceURL.replace(/\/$/, "") ?? spAddress;
      const pieceFetchStatus = finalPieceResult.success ? RetrievalStatus.SUCCESS : RetrievalStatus.FAILED;

      const carStatus = carStatusForRow(parse);
      const ipniStatus = ipniStatusForRow(parse, ipni);
      const blockFetchStatus = blockFetchStatusForRow(parse, blockFetch);

      try {
        this.clickhouseService.insert(SAMPLED_RETRIEVAL_CHECKS_TABLE, {
          timestamp: startedAt.getTime(),
          probe_location: this.clickhouseService.probeLocation,
          sp_address: spAddress,
          sp_id: provider?.providerId != null ? Number(provider.providerId) : null,
          sp_name: provider?.name ?? null,
          retrieval_id: retrievalId,
          piece_cid: piece.pieceCid,
          data_set_id: piece.dataSetId,
          piece_id: piece.pieceId,
          raw_size: piece.rawSize,
          with_ipfs_indexing: piece.withIPFSIndexing,
          ipfs_root_cid: piece.ipfsRootCid,
          service_type: ServiceType.DIRECT_SP,
          retrieval_endpoint: `${spBaseUrl}/piece/${piece.pieceCid}`,
          piece_fetch_status: pieceFetchStatus,
          http_response_code: finalPieceResult.statusCode > 0 ? finalPieceResult.statusCode : null,
          first_byte_ms: finalPieceResult.ttfbMs > 0 ? finalPieceResult.ttfbMs : null,
          last_byte_ms: finalPieceResult.latencyMs > 0 ? finalPieceResult.latencyMs : null,
          bytes_retrieved: finalPieceResult.bytesReceived > 0 ? finalPieceResult.bytesReceived : null,
          commp_valid: !finalPieceResult.aborted && finalPieceResult.httpSuccess ? finalPieceResult.commPValid : null,
          car_status: carStatus,
          car_block_count: parse && parse.status === CarParseStatus.SUCCESS ? parse.blockCount : null,
          block_fetch_endpoint: blockFetch?.endpoint ?? null,
          block_fetch_status: blockFetchStatus,
          block_fetch_sampled_count:
            parse?.status === CarParseStatus.SUCCESS && blockFetch ? blockFetch.sampledCount : null,
          block_fetch_failed_count: blockFetch?.failedCount ?? null,
          ipni_status: ipniStatus,
          ipni_verify_ms: ipni?.durationMs ?? null,
          error_message: finalPieceResult.errorMessage ?? null,
        });
      } catch (error) {
        // ClickhouseService.insert is buffered/non-throwing in normal operation, but
        // guard against unexpected runtime errors so we don't break the probe cycle.
        this.logger.warn({
          ...logContext,
          event: "sampled_retrieval_clickhouse_insert_failed",
          message: "Failed to enqueue anonymous retrieval row to ClickHouse",
          pieceCid: piece.pieceCid,
          spAddress,
          error: toStructuredError(error),
        });
      }

      this.logger.log({
        ...logContext,
        event: "sampled_retrieval_completed",
        message: "Anonymous retrieval test completed",
        retrievalId,
        pieceCid: piece.pieceCid,
        spAddress,
        success: finalPieceResult.success,
        aborted: finalPieceResult.aborted === true,
        latencyMs: finalPieceResult.latencyMs,
        ttfbMs: finalPieceResult.ttfbMs,
        bytesRetrieved: finalPieceResult.bytesReceived,
        carStatus,
        ipniStatus,
        blockFetchStatus,
      });
    }
  }
}

function sampledPieceRetrievalStatus(pieceResult: PieceRetrievalResult): string {
  if (pieceResult.success) return "success";
  if (pieceResult.aborted) return "failure.timedout";
  if (pieceResult.tooLarge) return "failure.too_large";
  if (!pieceResult.httpSuccess) return "failure.http";
  if (!pieceResult.commPValid) return "failure.commp";
  return "failure.other";
}

/**
 * The per-dimension statuses default to SKIPPED whenever the dimension's
 * prerequisite wasn't met — no IPFS indexing, piece fetch failed, the job
 * was aborted, or an upstream dimension didn't produce a usable result.
 * Service methods only ever return their concrete outcomes (success,
 * failure.*, etc.); SKIPPED is the helper's contribution.
 */
function carStatusForRow(parse: CarParseOutcome | null): CarParseStatus {
  if (!parse) return CarParseStatus.SKIPPED;
  return parse.status;
}

function ipniStatusForRow(parse: CarParseOutcome | null, ipni: IpniCheckOutcome | null): IpniCheckStatus {
  if (!parse || parse.status !== CarParseStatus.SUCCESS) return IpniCheckStatus.SKIPPED;
  if (!ipni) return IpniCheckStatus.SKIPPED;
  return ipni.status;
}

function blockFetchStatusForRow(parse: CarParseOutcome | null, blockFetch: BlockFetchOutcome | null): BlockFetchStatus {
  if (!parse || parse.status !== CarParseStatus.SUCCESS) return BlockFetchStatus.SKIPPED;
  if (!blockFetch) return BlockFetchStatus.SKIPPED;
  return blockFetch.status;
}

function buildAbortedPlaceholder(pieceCid: string, reason: unknown): PieceRetrievalResult {
  let message: string;
  if (reason instanceof Error) {
    message = reason.message;
  } else if (typeof reason === "string") {
    message = reason;
  } else {
    message = "aborted";
  }

  return {
    success: false,
    pieceCid,
    bytesReceived: 0,
    pieceBytes: null,
    latencyMs: 0,
    ttfbMs: 0,
    throughputBps: 0,
    statusCode: 0,
    httpSuccess: false,
    commPValid: false,
    errorMessage: message,
    aborted: true,
  };
}
