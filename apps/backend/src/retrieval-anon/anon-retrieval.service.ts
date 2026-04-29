import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { ClickhouseService } from "../clickhouse/clickhouse.service.js";
import { type ProviderJobContext, toStructuredError } from "../common/logging.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { RetrievalStatus, ServiceType } from "../database/types.js";
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
          carResult = await this.carValidationService.validateCarPiece(
            pieceResult.pieceBytes,
            provider,
            piece.ipfsRootCid,
            signal,
          );
        } catch (error) {
          this.logger.warn({
            ...logContext,
            event: "anon_retrieval_car_validation_failed",
            message: "CAR validation threw an error",
            pieceCid: piece.pieceCid,
            spAddress,
            error: toStructuredError(error),
          });
        }
      }

      // Emit CAR validation metrics
      if (carResult) {
        this.metrics.recordCarParseStatus(labels, carResult.carParseable);
        this.metrics.recordIpniStatus(
          labels,
          carResult.ipniValid === null ? "skipped" : carResult.ipniValid ? "valid" : "invalid",
        );
        this.metrics.recordBlockFetchStatus(
          labels,
          carResult.blockFetchValid === null ? "skipped" : carResult.blockFetchValid ? "valid" : "invalid",
        );
      } else if (!pieceResult.success) {
        // Piece retrieval failed — IPNI and block fetch were skipped
        this.metrics.recordIpniStatus(labels, "skipped");
        this.metrics.recordBlockFetchStatus(labels, "skipped");
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
      // collected.
      pieceResult ??= buildAbortedPlaceholder(piece.pieceCid, signal?.reason);
      this.emitClickhouseRow(spAddress, piece, pieceResult, carResult, startedAt, provider, logContext);
    }
  }

  private emitClickhouseRow(
    spAddress: string,
    piece: {
      pieceCid: string;
      dataSetId: string;
      pieceId: string;
      rawSize: string;
      withIPFSIndexing: boolean;
      ipfsRootCid: string | null;
    },
    pieceResult: PieceRetrievalResult,
    carResult: CarValidationResult | null,
    startedAt: Date,
    provider: StorageProvider | null,
    logContext?: ProviderJobContext,
  ): void {
    if (!this.clickhouseService.enabled) {
      this.logger.debug({
        ...logContext,
        event: "anon_retrieval_clickhouse_disabled",
        message: "ClickHouse disabled — anon retrieval row not emitted",
        pieceCid: piece.pieceCid,
        spAddress,
      });
      return;
    }

    const providerInfo = this.walletSdkService.getProviderInfo(spAddress);
    const spBaseUrl = providerInfo?.pdp.serviceURL.replace(/\/$/, "") ?? spAddress;
    const status = pieceResult.success ? RetrievalStatus.SUCCESS : RetrievalStatus.FAILED;
    const carValid = carResult ? carResult.ipniValid !== false && carResult.blockFetchValid !== false : null;
    const retrievalId = randomUUID();

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
        status,
        http_response_code: pieceResult.statusCode > 0 ? pieceResult.statusCode : null,
        first_byte_ms: pieceResult.ttfbMs > 0 ? pieceResult.ttfbMs : null,
        last_byte_ms: pieceResult.latencyMs > 0 ? pieceResult.latencyMs : null,
        bytes_retrieved: pieceResult.bytesReceived > 0 ? pieceResult.bytesReceived : null,
        throughput_bps: pieceResult.throughputBps > 0 ? Math.round(pieceResult.throughputBps) : null,
        commp_valid: pieceResult.success ? pieceResult.commPValid : null,
        car_valid: carValid,
        error_message: pieceResult.errorMessage ?? null,
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
      success: pieceResult.success,
      aborted: pieceResult.aborted === true,
      latencyMs: pieceResult.latencyMs,
      ttfbMs: pieceResult.ttfbMs,
      bytesRetrieved: pieceResult.bytesReceived,
      carParseable: carResult?.carParseable,
      ipniValid: carResult?.ipniValid,
      blockFetchValid: carResult?.blockFetchValid,
    });
  }
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
