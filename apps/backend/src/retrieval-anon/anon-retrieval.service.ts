import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { type ProviderJobContext, toStructuredError } from "../common/logging.js";
import { AnonRetrieval } from "../database/entities/anon-retrieval.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { RetrievalStatus, ServiceType } from "../database/types.js";
import { buildCheckMetricLabels } from "../metrics-prometheus/check-metric-labels.js";
import { AnonRetrievalCheckMetrics } from "../metrics-prometheus/check-metrics.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { AnonPieceSelectorService } from "./anon-piece-selector.service.js";
import { CarValidationService } from "./car-validation.service.js";
import { PieceRetrievalService } from "./piece-retrieval.service.js";
import type { CarValidationResult, PieceRetrievalResult } from "./types.js";

@Injectable()
export class AnonRetrievalService {
  private readonly logger = new Logger(AnonRetrievalService.name);

  constructor(
    private readonly anonPieceSelectorService: AnonPieceSelectorService,
    private readonly pieceRetrievalService: PieceRetrievalService,
    private readonly carValidationService: CarValidationService,
    private readonly walletSdkService: WalletSdkService,
    private readonly metrics: AnonRetrievalCheckMetrics,
    @InjectRepository(AnonRetrieval)
    private readonly anonRetrievalRepository: Repository<AnonRetrieval>,
    @InjectRepository(StorageProvider)
    private readonly spRepository: Repository<StorageProvider>,
  ) {}

  async performForProvider(
    spAddress: string,
    signal?: AbortSignal,
    logContext?: ProviderJobContext,
  ): Promise<AnonRetrieval | null> {
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
      return null;
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
    let saved: AnonRetrieval | null = null;

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
      // Always save a record — even on abort or unexpected error — so we never
      // lose the evidence (ttfb, bytes, response code) we already collected.
      pieceResult ??= buildAbortedPlaceholder(piece.pieceCid, signal?.reason);
      saved = await this.saveRetrievalRecord(spAddress, piece, pieceResult, carResult, startedAt, logContext);
    }

    return saved;
  }

  private async saveRetrievalRecord(
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
    logContext?: ProviderJobContext,
  ): Promise<AnonRetrieval | null> {
    const providerInfo = this.walletSdkService.getProviderInfo(spAddress);
    const spBaseUrl = providerInfo?.pdp.serviceURL.replace(/\/$/, "") ?? spAddress;

    const retrieval = this.anonRetrievalRepository.create({
      spAddress,
      pieceCid: piece.pieceCid,
      dataSetId: BigInt(piece.dataSetId),
      pieceId: BigInt(piece.pieceId),
      rawSize: BigInt(piece.rawSize),
      withIpfsIndexing: piece.withIPFSIndexing,
      ipfsRootCid: piece.ipfsRootCid,
      serviceType: ServiceType.DIRECT_SP,
      retrievalEndpoint: `${spBaseUrl}/piece/${piece.pieceCid}`,
      status: pieceResult.success ? RetrievalStatus.SUCCESS : RetrievalStatus.FAILED,
      startedAt,
      completedAt: new Date(),
      latencyMs: pieceResult.latencyMs > 0 ? Math.round(pieceResult.latencyMs) : null,
      ttfbMs: pieceResult.ttfbMs > 0 ? Math.round(pieceResult.ttfbMs) : null,
      throughputBps: pieceResult.throughputBps > 0 ? Math.round(pieceResult.throughputBps) : null,
      bytesRetrieved: pieceResult.bytesReceived > 0 ? pieceResult.bytesReceived : null,
      responseCode: pieceResult.statusCode > 0 ? pieceResult.statusCode : null,
      errorMessage: pieceResult.errorMessage ?? null,
      commpValid: pieceResult.success ? pieceResult.commPValid : null,
      carValid: carResult ? carResult.ipniValid !== false && carResult.blockFetchValid !== false : null,
    });

    try {
      await this.anonRetrievalRepository.save(retrieval);
    } catch (error) {
      this.logger.warn({
        ...logContext,
        event: "anon_retrieval_save_failed",
        message: "Failed to save anonymous retrieval record",
        pieceCid: piece.pieceCid,
        spAddress,
        error: toStructuredError(error),
      });
      return null;
    }

    this.logger.log({
      ...logContext,
      event: "anon_retrieval_completed",
      message: "Anonymous retrieval test completed",
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

    return retrieval;
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
