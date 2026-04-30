import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { ClickhouseService } from "../clickhouse/clickhouse.service.js";
import { type ProviderJobContext, toStructuredError } from "../common/logging.js";
import { AnonRetrieval } from "../database/entities/anon-retrieval.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { IpniCheckStatus, PieceFetchStatus, ServiceType } from "../database/types.js";
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
    @InjectRepository(AnonRetrieval)
    private readonly anonRetrievalRepository: Repository<AnonRetrieval>,
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
            carResult.blockFetchValid === null ? "skipped" : carResult.blockFetchValid ? "valid" : "invalid",
          );
        } catch (error) {
          // Validation was attempted on a successful piece retrieval but threw.
          this.metrics.recordCarParseStatus(labels, false);
          this.metrics.recordIpniStatus(labels, "error");
          this.metrics.recordBlockFetchStatus(labels, "error");
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
      // Always persist a row — even on abort or unexpected error — so we never
      // lose the evidence (ttfb, bytes, response code) we already collected.
      const finalPieceResult = pieceResult ?? buildAbortedPlaceholder(piece.pieceCid, signal?.reason);
      const providerInfo = this.walletSdkService.getProviderInfo(spAddress);
      const spBaseUrl = providerInfo?.pdp.serviceURL.replace(/\/$/, "") ?? spAddress;
      const retrievalEndpoint = `${spBaseUrl}/piece/${piece.pieceCid}`;
      const pieceFetchStatus = finalPieceResult.success ? PieceFetchStatus.SUCCESS : PieceFetchStatus.FAILED;
      const ipniStatus: IpniCheckStatus = !validatedCarPiece
        ? IpniCheckStatus.SKIPPED
        : carResult
          ? ipniStatusFromResult(carResult)
          : IpniCheckStatus.ERROR;

      const entity: AnonRetrieval = {
        id: randomUUID(),
        createdAt: startedAt,
        startedAt,
        probeLocation: this.clickhouseService.probeLocation,
        spAddress,
        spId: provider?.providerId ?? null,
        spName: provider?.name ?? null,
        pieceCid: piece.pieceCid,
        dataSetId: BigInt(piece.dataSetId),
        pieceId: BigInt(piece.pieceId),
        rawSize: BigInt(piece.rawSize),
        withIpfsIndexing: piece.withIPFSIndexing,
        ipfsRootCid: piece.ipfsRootCid,
        serviceType: ServiceType.DIRECT_SP,
        retrievalEndpoint,
        pieceFetchStatus,
        httpResponseCode: finalPieceResult.statusCode > 0 ? finalPieceResult.statusCode : null,
        firstByteMs: finalPieceResult.ttfbMs > 0 ? finalPieceResult.ttfbMs : null,
        lastByteMs: finalPieceResult.latencyMs > 0 ? finalPieceResult.latencyMs : null,
        bytesRetrieved: finalPieceResult.bytesReceived > 0 ? BigInt(finalPieceResult.bytesReceived) : null,
        throughputBps: finalPieceResult.throughputBps > 0 ? BigInt(Math.round(finalPieceResult.throughputBps)) : null,
        commpValid: finalPieceResult.success ? finalPieceResult.commPValid : null,
        carParseable: carResult ? carResult.carParseable : null,
        carBlockCount: carResult?.carParseable ? carResult.blockCount : null,
        blockFetchEndpoint: carResult?.blockFetchEndpoint ?? null,
        blockFetchValid: carResult ? carResult.blockFetchValid : null,
        blockFetchSampledCount: carResult?.carParseable ? carResult.sampledCidCount : null,
        blockFetchFailedCount: carResult?.blockFetchFailedCount ?? null,
        ipniStatus,
        ipniVerifyMs: carResult?.ipniVerifyMs ?? null,
        ipniVerifiedCidsCount: carResult?.ipniVerifiedCidsCount ?? null,
        ipniUnverifiedCidsCount: carResult?.ipniUnverifiedCidsCount ?? null,
        errorMessage: finalPieceResult.errorMessage ?? null,
      };

      try {
        await this.anonRetrievalRepository.save(entity);
      } catch (error) {
        this.logger.warn({
          ...logContext,
          event: "anon_retrieval_save_failed",
          message: "Failed to persist anonymous retrieval row to Postgres",
          pieceCid: piece.pieceCid,
          spAddress,
          error: toStructuredError(error),
        });
      }

      this.clickhouseService.insert(ANON_RETRIEVAL_CHECKS_TABLE, toClickhouseRow(entity));

      this.logger.log({
        ...logContext,
        event: "anon_retrieval_completed",
        message: "Anonymous retrieval test completed",
        retrievalId: entity.id,
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
  switch (result.ipniValid) {
    case null:
      return IpniCheckStatus.SKIPPED;
    case true:
      return IpniCheckStatus.VALID;
    case false:
      return IpniCheckStatus.INVALID;
    default:
      throw new Error(`Unexpected IPNI validation result: ${result.ipniValid}`);
  }
}

/**
 * Project an AnonRetrieval entity to the chartable subset stored in ClickHouse.
 * High-cardinality identifiers (piece_cid, data_set_id, piece_id, ipfs_root_cid),
 * URLs (retrieval_endpoint, block_fetch_endpoint), and free-text columns
 * (error_message) are intentionally dropped — they live only in Postgres.
 */
function toClickhouseRow(entity: AnonRetrieval): Record<string, unknown> {
  return {
    timestamp: entity.startedAt.getTime(),
    probe_location: entity.probeLocation,
    sp_address: entity.spAddress,
    sp_id: entity.spId != null ? Number(entity.spId) : null,
    sp_name: entity.spName,
    retrieval_id: entity.id,
    raw_size: Number(entity.rawSize),
    with_ipfs_indexing: entity.withIpfsIndexing,
    service_type: entity.serviceType,
    piece_fetch_status: entity.pieceFetchStatus,
    http_response_code: entity.httpResponseCode,
    first_byte_ms: entity.firstByteMs,
    last_byte_ms: entity.lastByteMs,
    bytes_retrieved: entity.bytesRetrieved != null ? Number(entity.bytesRetrieved) : null,
    throughput_bps: entity.throughputBps != null ? Number(entity.throughputBps) : null,
    commp_valid: entity.commpValid,
    car_parseable: entity.carParseable,
    car_block_count: entity.carBlockCount,
    block_fetch_valid: entity.blockFetchValid,
    block_fetch_sampled_count: entity.blockFetchSampledCount,
    block_fetch_failed_count: entity.blockFetchFailedCount,
    ipni_status: entity.ipniStatus,
    ipni_verify_ms: entity.ipniVerifyMs,
    ipni_verified_cids_count: entity.ipniVerifiedCidsCount,
    ipni_unverified_cids_count: entity.ipniUnverifiedCidsCount,
  };
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
