import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { ClickhouseService } from "../clickhouse/clickhouse.service.js";
import { type ProviderJobContext, toStructuredError } from "../common/logging.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { IpniCheckStatus, RetrievalStatus, ServiceType } from "../database/types.js";
import { buildCheckMetricLabels } from "../metrics-prometheus/check-metric-labels.js";
import { AnonRetrievalCheckMetrics } from "../metrics-prometheus/check-metrics.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { AnonPieceSelectorService } from "./anon-piece-selector.service.js";
import { CarValidationService } from "./car-validation.service.js";
import { PieceRetrievalService } from "./piece-retrieval.service.js";
import type { CarValidationResult, PieceRetrievalResult } from "./types.js";

const ANON_RETRIEVAL_CHECKS_TABLE = "anon_retrieval_checks";

@Injectable()
export class AnonRetrievalService {
  private readonly logger = new Logger(AnonRetrievalService.name);

  constructor(
    private readonly anonPieceSelectorService: AnonPieceSelectorService,
    private readonly pieceRetrievalService: PieceRetrievalService,
    private readonly carValidationService: CarValidationService,
    private readonly walletSdkService: WalletSdkService,
    private readonly metrics: AnonRetrievalCheckMetrics,
    private readonly clickhouseService: ClickhouseService,
    @InjectRepository(StorageProvider)
    private readonly spRepository: Repository<StorageProvider>,
  ) {}

  async performForProvider(spAddress: string, signal?: AbortSignal, logContext?: ProviderJobContext): Promise<void> {
    // Build metric labels
    const provider = await this.spRepository.findOne({ where: { address: spAddress } });
    const labels = buildCheckMetricLabels({
      checkType: "anon_retrieval",
      providerId: provider?.providerId,
      providerName: provider?.name,
      providerIsApproved: provider?.isApproved,
    });

    // 1. Select an anonymous piece
    const piece = await this.anonPieceSelectorService.selectPieceForProvider(spAddress);
    if (!piece) {
      this.logger.warn({
        ...logContext,
        event: "anon_retrieval_no_piece",
        message: "No anonymous piece found for SP",
        spAddress,
      });
      this.metrics.recordStatus(labels, "failure.no_piece");
      return;
    }

    this.logger.log({
      ...logContext,
      event: "anon_retrieval_started",
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
    let carResult: CarValidationResult | null = null;
    let validatedCarPiece: boolean = false;

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

      // 3. CAR validation (only if piece was successfully retrieved and has IPFS indexing)
      if (
        pieceResult.success &&
        piece.withIPFSIndexing &&
        piece.ipfsRootCid &&
        pieceResult.pieceBytes &&
        provider &&
        !signal?.aborted
      ) {
        try {
          validatedCarPiece = true;
          carResult = await this.carValidationService.validateCarPiece(
            pieceResult.pieceBytes,
            provider,
            piece.ipfsRootCid,
            signal,
          );
          this.metrics.recordCarParseStatus(labels, carResult.carParseable);
          this.metrics.recordIpniStatus(labels, ipniStatusFromResult(carResult));
          this.metrics.recordBlockFetchStatus(
            labels,
            carResult.blockFetchValid === null
              ? IpniCheckStatus.SKIPPED
              : carResult.blockFetchValid
                ? IpniCheckStatus.VALID
                : IpniCheckStatus.INVALID,
          );
        } catch (error) {
          // Validation was attempted on a successful piece retrieval but threw.
          this.metrics.recordCarParseStatus(labels, false);
          this.metrics.recordIpniStatus(labels, IpniCheckStatus.ERROR);
          this.metrics.recordBlockFetchStatus(labels, IpniCheckStatus.ERROR);
          this.logger.warn({
            ...logContext,
            event: "anon_retrieval_car_validation_failed",
            message: "CAR validation threw an error",
            pieceCid: piece.pieceCid,
            spAddress,
            error: toStructuredError(error),
          });
        }
      } else if (!pieceResult.success) {
        // Piece retrieval failed — IPNI and block fetch were skipped
        this.metrics.recordIpniStatus(labels, IpniCheckStatus.SKIPPED);
        this.metrics.recordBlockFetchStatus(labels, IpniCheckStatus.SKIPPED);
      }

      // Overall check duration and status
      this.metrics.observeCheckDuration(labels, Date.now() - checkStart);
      this.metrics.recordStatus(
        labels,
        pieceResult.success ? "success" : pieceResult.aborted ? "failure.aborted" : "failure.http",
      );
    } finally {
      // Always emit a ClickHouse row — even on abort or unexpected error — so
      // we never lose the evidence (ttfb, bytes, response code) we already
      // collected. ClickhouseService.insert is a no-op when disabled.
      const finalPieceResult = pieceResult ?? buildAbortedPlaceholder(piece.pieceCid, signal?.reason);
      const retrievalId = randomUUID();
      const providerInfo = this.walletSdkService.getProviderInfo(spAddress);
      const spBaseUrl = providerInfo?.pdp.serviceURL.replace(/\/$/, "") ?? spAddress;
      const pieceFetchStatus = finalPieceResult.success ? RetrievalStatus.SUCCESS : RetrievalStatus.FAILED;
      const ipniStatus: IpniCheckStatus = !validatedCarPiece
        ? IpniCheckStatus.SKIPPED
        : carResult
          ? ipniStatusFromResult(carResult)
          : IpniCheckStatus.ERROR;

      try {
        this.clickhouseService.insert(ANON_RETRIEVAL_CHECKS_TABLE, {
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
          throughput_bps: finalPieceResult.throughputBps > 0 ? Math.round(finalPieceResult.throughputBps) : null,
          commp_valid: finalPieceResult.success ? finalPieceResult.commPValid : null,
          car_parseable: carResult ? carResult.carParseable : null,
          car_block_count: carResult?.carParseable ? carResult?.blockCount : null,
          block_fetch_endpoint: carResult?.blockFetchEndpoint ?? null,
          block_fetch_valid: carResult ? carResult.blockFetchValid : null,
          block_fetch_sampled_count: carResult?.carParseable ? carResult?.sampledCidCount : null,
          block_fetch_failed_count: carResult?.blockFetchFailedCount ?? null,
          ipni_status: ipniStatus,
          ipni_verify_ms: carResult?.ipniVerifyMs ?? null,
          error_message: finalPieceResult.errorMessage ?? null,
        });
      } catch (error) {
        // ClickhouseService.insert is buffered/non-throwing in normal operation, but
        // guard against unexpected runtime errors so we don't break the probe cycle.
        this.logger.warn({
          ...logContext,
          event: "anon_retrieval_clickhouse_insert_failed",
          message: "Failed to enqueue anonymous retrieval row to ClickHouse",
          pieceCid: piece.pieceCid,
          spAddress,
          error: toStructuredError(error),
        });
      }

      this.logger.log({
        ...logContext,
        event: "anon_retrieval_completed",
        message: "Anonymous retrieval test completed",
        retrievalId,
        pieceCid: piece.pieceCid,
        spAddress,
        success: finalPieceResult.success,
        aborted: finalPieceResult.aborted === true,
        latencyMs: finalPieceResult.latencyMs,
        ttfbMs: finalPieceResult.ttfbMs,
        bytesRetrieved: finalPieceResult.bytesReceived,
        carParseable: carResult?.carParseable,
        ipniValid: carResult?.ipniValid,
        blockFetchValid: carResult?.blockFetchValid,
      });
    }
  }
}

function ipniStatusFromResult(result: CarValidationResult): IpniCheckStatus {
  if (result.ipniValid === null) return IpniCheckStatus.SKIPPED;
  return result.ipniValid ? IpniCheckStatus.VALID : IpniCheckStatus.INVALID;
}

function buildAbortedPlaceholder(pieceCid: string, reason: unknown): PieceRetrievalResult {
  const message =
    reason instanceof Error && reason.message ? reason.message : typeof reason === "string" ? reason : "aborted";
  return {
    success: false,
    pieceCid,
    bytesReceived: 0,
    pieceBytes: null,
    latencyMs: 0,
    ttfbMs: 0,
    throughputBps: 0,
    statusCode: 0,
    commPValid: false,
    errorMessage: message,
    aborted: true,
  };
}
