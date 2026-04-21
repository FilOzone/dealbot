import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { type ProviderJobContext, toStructuredError } from "../common/logging.js";
import { Retrieval } from "../database/entities/retrieval.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { RetrievalStatus, ServiceType } from "../database/types.js";
import { buildCheckMetricLabels } from "../metrics-prometheus/check-metric-labels.js";
import { AnonRetrievalCheckMetrics } from "../metrics-prometheus/check-metrics.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { AnonPieceSelectorService } from "./anon-piece-selector.service.js";
import { CarValidationService } from "./car-validation.service.js";
import { PieceRetrievalService } from "./piece-retrieval.service.js";
import type { CarValidationResult } from "./types.js";

@Injectable()
export class AnonRetrievalService {
  private readonly logger = new Logger(AnonRetrievalService.name);

  constructor(
    private readonly anonPieceSelectorService: AnonPieceSelectorService,
    private readonly pieceRetrievalService: PieceRetrievalService,
    private readonly carValidationService: CarValidationService,
    private readonly walletSdkService: WalletSdkService,
    private readonly metrics: AnonRetrievalCheckMetrics,
    @InjectRepository(Retrieval)
    private readonly retrievalRepository: Repository<Retrieval>,
    @InjectRepository(StorageProvider)
    private readonly spRepository: Repository<StorageProvider>,
  ) {}

  async performForProvider(
    spAddress: string,
    signal?: AbortSignal,
    logContext?: ProviderJobContext,
  ): Promise<Retrieval | null> {
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

    // 2. Fetch the piece
    signal?.throwIfAborted();
    const pieceResult = await this.pieceRetrievalService.fetchPiece(spAddress, piece.pieceCid, signal);

    // Emit piece retrieval metrics
    this.metrics.observeFirstByteMs(labels, pieceResult.ttfbMs);
    this.metrics.observeLastByteMs(labels, pieceResult.latencyMs);
    this.metrics.observeThroughput(labels, pieceResult.throughputBps);
    this.metrics.recordHttpResponseCode(labels, pieceResult.statusCode);

    // 3. CAR validation (only if piece was successfully retrieved and has IPFS indexing)
    let carResult: CarValidationResult | null = null;
    if (pieceResult.success && piece.withIPFSIndexing && piece.ipfsRootCid && pieceResult.pieceBytes && provider) {
      signal?.throwIfAborted();
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
    this.metrics.recordStatus(labels, pieceResult.success ? "success" : "failure.http");

    // 4. Build the SP base URL for the retrieval endpoint
    const providerInfo = this.walletSdkService.getProviderInfo(spAddress);
    const spBaseUrl = providerInfo?.pdp.serviceURL.replace(/\/$/, "") ?? spAddress;

    // 5. Save retrieval record
    const retrieval = this.retrievalRepository.create({
      isAnonymous: true,
      anonPieceCid: piece.pieceCid,
      anonDataSetId: piece.dataSetId,
      anonPieceId: piece.pieceId,
      serviceType: ServiceType.DIRECT_SP,
      retrievalEndpoint: `${spBaseUrl}/piece/${piece.pieceCid}`,
      status: pieceResult.success ? RetrievalStatus.SUCCESS : RetrievalStatus.FAILED,
      startedAt,
      completedAt: new Date(),
      latencyMs: Math.round(pieceResult.latencyMs),
      ttfbMs: Math.round(pieceResult.ttfbMs),
      throughputBps: Math.round(pieceResult.throughputBps),
      bytesRetrieved: pieceResult.bytesReceived,
      responseCode: pieceResult.statusCode,
      errorMessage: pieceResult.errorMessage,
      commPValid: pieceResult.success ? pieceResult.commPValid : undefined,
      carValid: carResult ? carResult.ipniValid !== false && carResult.blockFetchValid !== false : undefined,
    });

    try {
      await this.retrievalRepository.save(retrieval);
    } catch (error) {
      this.logger.warn({
        ...logContext,
        event: "anon_retrieval_save_failed",
        message: "Failed to save anonymous retrieval record",
        pieceCid: piece.pieceCid,
        spAddress,
        error: toStructuredError(error),
      });
    }

    this.logger.log({
      ...logContext,
      event: "anon_retrieval_completed",
      message: "Anonymous retrieval test completed",
      pieceCid: piece.pieceCid,
      spAddress,
      success: pieceResult.success,
      latencyMs: pieceResult.latencyMs,
      carParseable: carResult?.carParseable,
      ipniValid: carResult?.ipniValid,
      blockFetchValid: carResult?.blockFetchValid,
    });

    return retrieval;
  }
}
