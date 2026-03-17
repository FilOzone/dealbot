import { METADATA_KEYS } from "@filoz/synapse-sdk";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { CID } from "multiformats/cid";
import { StorageProvider } from "src/database/entities/storage-provider.entity.js";
import type { Repository } from "typeorm";
import { delay } from "../../common/abort-utils.js";
import { buildUnixfsCar } from "../../common/car-utils.js";
import { type DealLogContext, toStructuredError } from "../../common/logging.js";
import type { IConfig } from "../../config/app.config.js";
import { Deal } from "../../database/entities/deal.entity.js";
import type { DealMetadata, IpniMetadata } from "../../database/types.js";
import { IpniStatus, ServiceType } from "../../database/types.js";
import { HttpClientService } from "../../http-client/http-client.service.js";
import { IpniVerificationService } from "../../ipni/ipni-verification.service.js";
import { classifyFailureStatus } from "../../metrics/utils/check-metric-labels.js";
import { DiscoverabilityCheckMetrics } from "../../metrics/utils/check-metrics.service.js";

import type { IDealAddon } from "../interfaces/deal-addon.interface.js";
import type { AddonExecutionContext, DealConfiguration, IpniPreprocessingResult, SynapseConfig } from "../types.js";
import { AddonPriority } from "../types.js";
import type { MonitorAndVerifyResult, PieceMonitoringResult, PieceStatus, PieceStatusResponse } from "./ipni.types.js";
import { validatePieceStatusResponse } from "./ipni.types.js";

/**
 * IPNI (InterPlanetary Network Indexer) add-on strategy
 * Converts data to CAR format for IPFS indexing and retrieval
 * This is a data transformation add-on that runs with high priority
 */
@Injectable()
export class IpniAddonStrategy implements IDealAddon<IpniMetadata> {
  private readonly logger = new Logger(IpniAddonStrategy.name);

  constructor(
    @InjectRepository(Deal)
    private readonly dealRepository: Repository<Deal>,
    private readonly httpClientService: HttpClientService,
    private readonly discoverabilityMetrics: DiscoverabilityCheckMetrics,
    private readonly ipniVerificationService: IpniVerificationService,
    private readonly configService: ConfigService<IConfig, true>,
  ) {}

  readonly name = ServiceType.IPFS_PIN;
  readonly priority = AddonPriority.HIGH; // Run first to transform data
  readonly POLLING_INTERVAL_MS = 2500;
  readonly POLLING_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes - max time to wait for SP to advertise piece

  /**
   * Check if IPNI is enabled in the deal configuration
   */
  isApplicable(config: DealConfiguration): boolean {
    return config.enableIpni;
  }

  /**
   * Convert data to CAR format for IPNI indexing
   * This is the main preprocessing step that transforms the data
   */
  async preprocessData(context: AddonExecutionContext, signal?: AbortSignal): Promise<IpniPreprocessingResult> {
    try {
      signal?.throwIfAborted();
      const carResult = await buildUnixfsCar(context.currentData, { signal });

      this.logger.log({
        event: "ipni_car_conversion_completed",
        message: "CAR conversion completed",
        blockCount: carResult.blockCount,
        carSizeKB: Math.round((carResult.carSize / 1024) * 10) / 10,
        carSizeBytes: carResult.carSize,
      });

      const metadata: IpniMetadata = {
        enabled: true,
        rootCID: carResult.rootCID.toString(),
        blockCIDs: carResult.blockCIDs.map((cid) => cid.toString()),
        blockCount: carResult.blockCount,
        carSize: carResult.carSize,
        originalSize: context.currentData.size,
      };

      return {
        metadata,
        data: carResult.carData,
        size: carResult.carSize,
        originalData: context.currentData.data,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({
        event: "ipni_car_conversion_failed",
        message: "CAR conversion failed",
        error: toStructuredError(error),
      });
      throw new Error(`IPNI preprocessing failed: ${errorMessage}`);
    }
  }

  /**
   * Configure Synapse SDK to enable IPNI
   */
  getSynapseConfig(dealMetadata?: DealMetadata): SynapseConfig {
    if (!dealMetadata?.[this.name]) {
      return {};
    }

    const rootCID = dealMetadata[this.name]?.rootCID;
    if (!rootCID) {
      return {};
    }

    return {
      dataSetMetadata: {
        [METADATA_KEYS.WITH_IPFS_INDEXING]: "",
      },
      pieceMetadata: {
        [METADATA_KEYS.IPFS_ROOT_CID]: rootCID,
      },
    };
  }

  /**
   * Handler triggered when upload is complete
   * Runs IPNI tracking and verification before continuing
   */
  async onUploadComplete(deal: Deal, signal?: AbortSignal, logContext?: Partial<DealLogContext>): Promise<void> {
    if (!deal.storageProvider) {
      this.logger.warn({
        ...logContext,
        event: "ipni_no_storage_provider",
        message: "No storage provider for deal",
      });
      return;
    }

    // Set initial IPNI status to pending
    deal.ipniStatus = IpniStatus.PENDING;
    await this.dealRepository.save(deal);
    this.discoverabilityMetrics.recordStatus(this.discoverabilityMetrics.buildLabelsForDeal(deal), "pending");

    signal?.throwIfAborted();

    this.logger.log({
      ...logContext,
      event: "ipni_tracking_started",
      message: "IPNI tracking started",
    });

    await this.startIpniMonitoring(deal, signal, logContext);
  }

  /**
   * Validate CAR conversion result
   */
  async validate(result: IpniPreprocessingResult): Promise<boolean> {
    const metadata = result.metadata;

    if (!metadata.enabled) {
      throw new Error("IPNI validation failed: enabled flag not set");
    }

    if (!metadata.rootCID) {
      throw new Error("IPNI validation failed: rootCID not generated");
    }

    if (!metadata.blockCIDs || metadata.blockCIDs.length === 0) {
      throw new Error("IPNI validation failed: no block CIDs generated");
    }

    if (metadata.blockCount !== metadata.blockCIDs.length) {
      throw new Error(
        `IPNI validation failed: block count mismatch (expected ${metadata.blockCount}, got ${metadata.blockCIDs.length})`,
      );
    }

    if (!result.data || result.size === 0) {
      throw new Error("IPNI validation failed: CAR data is empty");
    }

    return true;
  }

  /**
   * Start IPNI monitoring and update deal entity with tracking metrics
   */
  private async startIpniMonitoring(
    deal: Deal,
    signal?: AbortSignal,
    logContext?: Partial<DealLogContext>,
  ): Promise<void> {
    if (!deal.storageProvider) {
      // this should never happen, we need to tighten up the types for successful deals.
      this.logger.warn({
        ...logContext,
        event: "ipni_no_storage_provider",
        message: "No storage provider for deal",
      });
      return;
    }

    const dealLogContext: DealLogContext = {
      ...logContext,
      jobId: logContext?.jobId,
      dealId: deal.id,
      providerAddress: deal.spAddress,
      providerId: deal.storageProvider.providerId ?? logContext?.providerId,
      providerName: deal.storageProvider?.name ?? logContext?.providerName,
      pieceCid: deal.pieceCid,
      ipfsRootCID: deal.metadata[this.name]?.rootCID,
    };

    let finalDiscoverabilityStatus: string | null = null;
    try {
      signal?.throwIfAborted();
      const serviceUrl = deal.storageProvider.serviceUrl;

      const rootCID = deal.metadata[this.name]?.rootCID ?? "";
      const blockCIDs = deal.metadata[this.name]?.blockCIDs ?? [];
      const timeouts = this.configService.get("timeouts");
      const ipniTimeoutMs = timeouts.ipniVerificationTimeoutMs;
      const ipniPollIntervalMs = timeouts.ipniVerificationPollingMs;

      const result = await this.monitorAndVerifyIPNI(
        serviceUrl,
        deal,
        blockCIDs.map((cid) => CID.parse(cid)),
        rootCID,
        deal.storageProvider,
        this.POLLING_TIMEOUT_MS,
        ipniTimeoutMs,
        this.POLLING_INTERVAL_MS,
        ipniPollIntervalMs,
        dealLogContext,
        signal,
      );

      signal?.throwIfAborted();

      // Update deal entity with tracking metrics
      finalDiscoverabilityStatus = await this.updateDealWithIpniMetrics(deal, result, dealLogContext);

      signal?.throwIfAborted();

      if (!result.ipniResult.rootCIDVerified) {
        throw new Error(`IPNI verification failed for deal ${deal.id}: root CID not verified`);
      }
    } catch (error) {
      signal?.throwIfAborted();
      // Mark IPNI as failed and save to database
      deal.ipniStatus = IpniStatus.FAILED;

      try {
        await this.dealRepository.save(deal);
        this.logger.warn({
          ...dealLogContext,
          event: "ipni_tracking_failed",
          message: "IPNI tracking failed",
          error: toStructuredError(error),
        });
      } catch (saveError) {
        this.logger.error({
          ...dealLogContext,
          event: "ipni_failure_status_save_failed",
          message: "Failed to save IPNI failure status",
          error: toStructuredError(saveError),
        });
      }

      if (!finalDiscoverabilityStatus) {
        const failureStatus = classifyFailureStatus(error);
        this.discoverabilityMetrics.recordStatus(this.discoverabilityMetrics.buildLabelsForDeal(deal), failureStatus);
      }

      // Re-throw to be caught by onUploadComplete handler
      throw error;
    }
  }

  async monitorAndVerifyIPNI(
    serviceURL: string,
    deal: Deal,
    blockCIDs: CID[],
    rootCID: string,
    storageProvider: StorageProvider,
    statusTimeoutMs: number,
    ipniTimeoutMs: number,
    pollIntervalMs: number,
    ipniPollIntervalMs: number,
    dealLogContext: DealLogContext,
    signal?: AbortSignal,
  ): Promise<MonitorAndVerifyResult> {
    const pieceCid = deal.pieceCid;
    let monitoringResult: PieceMonitoringResult;
    try {
      // we monitor the piece status by calling the SP directly to get piece status. as soon as it's advertised, we can move on to verifying the IPNI advertisement.
      monitoringResult = await this.monitorPieceStatus(
        serviceURL,
        pieceCid,
        statusTimeoutMs,
        pollIntervalMs,
        dealLogContext,
        signal,
      );
    } catch (error) {
      signal?.throwIfAborted();
      this.logger.warn({
        ...dealLogContext,
        event: "ipni_piece_status_monitoring_incomplete",
        message: "Piece status monitoring incomplete",
        error: toStructuredError(error),
      });
      monitoringResult = {
        success: false,
        finalStatus: {
          status: "timeout",
          indexed: false,
          advertised: false,
          indexedAt: null,
          advertisedAt: null,
        },
        checks: 0,
        durationMs: statusTimeoutMs,
      };
    }

    if (!rootCID || blockCIDs.length === 0) {
      const totalCandidates = blockCIDs.length + (rootCID ? 1 : 0);
      this.logger.warn({
        ...dealLogContext,
        event: "ipni_verification_input_missing",
        message: "No rootCID or blockCIDs for deal",
        hasRootCID: Boolean(rootCID),
        blockCIDCount: blockCIDs.length,
      });
      return {
        monitoringResult,
        ipniResult: {
          verified: 0,
          unverified: totalCandidates,
          total: totalCandidates,
          rootCIDVerified: false,
          durationMs: Infinity, // what is the right value here...
          failedCIDs: [...(rootCID ? [rootCID] : []), ...blockCIDs.map((cid) => cid.toString())].map((cid) => ({
            cid,
            reason: "No rootCID or blockCIDs for deal",
          })),
          verifiedAt: new Date().toISOString(),
        },
      };
    }

    let rootCidObj: CID;
    try {
      rootCidObj = CID.parse(rootCID);
    } catch (error) {
      this.logger.warn({
        ...dealLogContext,
        event: "ipni_verification_input_invalid",
        message: "Invalid rootCID for deal",
        rootCID,
        error: toStructuredError(error),
      });
      return {
        monitoringResult,
        ipniResult: {
          verified: 0,
          unverified: blockCIDs.length + 1,
          total: blockCIDs.length + 1,
          rootCIDVerified: false,
          durationMs: Infinity,
          failedCIDs: [rootCID, ...blockCIDs.map((cid) => cid.toString())].map((cid) => ({
            cid,
            reason: "Invalid rootCID for deal",
          })),
          verifiedAt: new Date().toISOString(),
        },
      };
    }

    this.logger.log({
      ...dealLogContext,
      event: "ipni_root_cid_verification_started",
      message: "Verifying rootCID in IPNI",
      rootCID,
      blockCIDCount: blockCIDs.length,
      ipniVerificationTimeoutMs: ipniTimeoutMs,
      ipniVerificationPollingMs: ipniPollIntervalMs,
    });
    // NOTE: filecoin-pin does not currently validate that all blocks are advertised on IPNI.
    const ipniResult = await this.ipniVerificationService.verify({
      rootCid: rootCidObj,
      blockCids: blockCIDs,
      storageProvider,
      timeoutMs: ipniTimeoutMs,
      pollIntervalMs: ipniPollIntervalMs,
      signal,
    });

    this.discoverabilityMetrics.observeIpniVerifyMs(
      this.discoverabilityMetrics.buildLabelsForDeal(deal),
      ipniResult.durationMs,
    );

    if (ipniResult.rootCIDVerified) {
      this.logger.log({
        ...dealLogContext,
        event: "ipni_root_cid_verified",
        message: "IPNI rootCID verified",
        rootCID,
        verifyDurationMs: ipniResult.durationMs,
      });
    } else {
      this.logger.warn({
        ...dealLogContext,
        event: "ipni_root_cid_verification_failed",
        message: "IPNI rootCID verification failed",
        rootCID,
        verifyDurationMs: ipniResult.durationMs,
        failureReason: ipniResult.failedCIDs[0]?.reason,
        failedCIDs: ipniResult.failedCIDs,
      });
    }

    return {
      monitoringResult,
      ipniResult,
    };
  }

  async monitorPieceStatus(
    serviceURL: string,
    pieceCid: string,
    maxDurationMs: number,
    pollIntervalMs: number,
    dealLogContext?: DealLogContext,
    signal?: AbortSignal,
  ): Promise<PieceMonitoringResult> {
    const startTime = Date.now();
    let lastStatus: PieceStatus = {
      status: "",
      indexed: false,
      advertised: false,
      indexedAt: null,
      advertisedAt: null,
    };
    let checkCount = 0;

    while (Date.now() - startTime < maxDurationMs) {
      signal?.throwIfAborted();
      checkCount++;

      try {
        const sdkStatus = await this.getPieceStatus(serviceURL, pieceCid, signal, dealLogContext);
        signal?.throwIfAborted();

        const currentStatus: PieceStatus = {
          status: sdkStatus.status,
          indexed: sdkStatus.indexed,
          advertised: sdkStatus.advertised,
          // sdkStatus does not provide these fields, so we use the last known values
          indexedAt: lastStatus.indexedAt,
          advertisedAt: lastStatus.advertisedAt,
        };

        // Update indexedAt and advertisedAt if they have changed
        if (currentStatus.indexed && !currentStatus.indexedAt) {
          currentStatus.indexedAt = new Date().toISOString();
          if (!lastStatus.indexed) {
            this.logger.log({
              ...dealLogContext,
              pieceCid,
              event: "piece_status_indexed",
              message: "Piece indexed",
            });
          }
        }

        // Return as soon as status has changed to advertised
        if (currentStatus.advertised && !currentStatus.advertisedAt) {
          currentStatus.advertisedAt = new Date().toISOString();
          if (!lastStatus.advertised) {
            this.logger.log({
              ...dealLogContext,
              pieceCid,
              event: "piece_status_advertised",
              message: "Piece advertised",
            });
          }
          return {
            success: true,
            finalStatus: currentStatus,
            checks: checkCount,
            durationMs: Date.now() - startTime,
          };
        }

        lastStatus = currentStatus;
      } catch (error) {
        signal?.throwIfAborted();
        if (checkCount % 20 === 0) {
          this.logger.debug({
            event: "piece_status_check_error",
            message: "Status check error",
            pieceCid,
            error: toStructuredError(error),
          });
        }
      }

      await delay(pollIntervalMs, signal);
    }

    // Timeout reached
    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
    this.logger.warn({
      ...dealLogContext,
      pieceCid,
      event: "piece_status_timeout",
      message: "Piece retrieval timeout",
      durationSec: Number(durationSec),
    });
    throw new Error(`Timeout waiting for piece retrieval after ${durationSec}s`);
  }

  /**
   * Get indexing and IPNI status for a piece from PDP server
   */
  private async getPieceStatus(
    serviceURL: string,
    pieceCid: string,
    signal?: AbortSignal,
    logContext?: DealLogContext,
  ): Promise<PieceStatusResponse> {
    if (!pieceCid || typeof pieceCid !== "string") {
      throw new Error(`Invalid PieceCID: ${String(pieceCid)}`);
    }

    const url = `${serviceURL}/pdp/piece/${pieceCid}/status`;
    this.logger.debug({
      ...logContext,
      event: "piece_status_request",
      message: "Getting piece status",
      serviceURL,
    });

    try {
      const { data } = await this.httpClientService.requestWithMetrics<Buffer>(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal,
      });
      const parsed = JSON.parse(data.toString());
      return validatePieceStatusResponse(parsed);
    } catch (error) {
      const errorResponse = this.getHttpErrorResponse(error);
      if (errorResponse?.status) {
        const errorText = this.formatHttpErrorData(errorResponse.data);
        if (errorResponse.status === 404) {
          const message = `Piece not found or does not belong to service: ${errorText}`;
          this.logger.warn({
            ...logContext,
            event: "piece_status_request_failed",
            message: "Failed to get piece status",
            pieceCid,
            statusCode: errorResponse.status,
            detail: message,
            error: toStructuredError(error),
          });
          throw new Error(message);
        }
        const statusText = errorResponse.statusText ?? "";
        const message = `Failed to get piece status: ${errorResponse.status} ${statusText} - ${errorText}`;
        this.logger.warn({
          ...logContext,
          event: "piece_status_request_failed",
          message: "Failed to get piece status",
          statusCode: errorResponse.status,
          detail: message,
          error: toStructuredError(error),
        });
        throw new Error(message);
      }

      this.logger.warn({
        ...logContext,
        event: "piece_status_request_failed",
        message: "Failed to get piece status",
        pieceCid,
        error: toStructuredError(error),
      });
      throw error;
    }
  }

  private getHttpErrorResponse(error: unknown): { status?: number; statusText?: string; data?: unknown } | undefined {
    if (typeof error !== "object" || error === null) {
      return undefined;
    }

    if (!("response" in error)) {
      return undefined;
    }

    const response = (error as { response?: unknown }).response;
    if (typeof response !== "object" || response === null) {
      return undefined;
    }

    return response as { status?: number; statusText?: string; data?: unknown };
  }

  private formatHttpErrorData(data: unknown): string {
    if (Buffer.isBuffer(data)) {
      return data.toString();
    }

    if (typeof data === "string") {
      return data;
    }

    if (data == null) {
      return "unknown error";
    }

    try {
      return JSON.stringify(data);
    } catch {
      return String(data);
    }
  }

  /**
   * Update deal entity with IPNI tracking metrics
   */
  private async updateDealWithIpniMetrics(
    deal: Deal,
    result: MonitorAndVerifyResult,
    dealLogContext: DealLogContext,
  ): Promise<string> {
    const { monitoringResult, ipniResult } = result;
    const { finalStatus } = monitoringResult;
    const now = new Date();
    const uploadEndTime = deal.uploadEndTime;
    const labels = this.discoverabilityMetrics.buildLabelsForDeal(deal);

    // Determine IPNI status based on progression
    // Terminal state is VERIFIED when rootCID (minimum) is verified via filecoinpin.contact
    // The rootCID must be verified for the deal to be considered verified
    if (ipniResult.rootCIDVerified) {
      deal.ipniStatus = IpniStatus.VERIFIED;
    } else if (finalStatus.advertised) {
      deal.ipniStatus = IpniStatus.SP_ADVERTISED;
    } else if (finalStatus.indexed) {
      deal.ipniStatus = IpniStatus.SP_INDEXED;
    } else {
      deal.ipniStatus = IpniStatus.FAILED;
    }

    // Helper function to calculate duration in milliseconds
    // return null if uploadEndTime is missing ( metrics are meaningless when start time is missing )
    // log warning for unexpected case where end time is before start time
    const calculateDuration = (eventTime: Date, eventName: string): number | null => {
      if (!uploadEndTime) return null;
      const duration = Math.round(eventTime.getTime() - uploadEndTime.getTime());

      if (duration <= 0) {
        this.logger.warn({
          ...dealLogContext,
          event: "ipni_invalid_duration",
          message: "Invalid duration calculated",
          eventName,
          durationMs: duration,
          eventTime: eventTime.toISOString(),
          uploadEndTime: uploadEndTime.toISOString(),
        });
        return null;
      }

      return duration;
    };

    // Update timestamps and calculate time-to-stage metrics
    if (finalStatus.indexed && !deal.ipniIndexedAt) {
      const indexedTimestamp = finalStatus.indexedAt ? new Date(finalStatus.indexedAt) : now;
      deal.ipniIndexedAt = indexedTimestamp;

      this.discoverabilityMetrics.recordStatus(labels, "sp_indexed");

      const timeToIndexMs = calculateDuration(indexedTimestamp, "indexed");
      if (timeToIndexMs) {
        /**
         * Time taken for the SP to index the piece after upload:
         * time = indexedAt - uploadEndTime
         */
        deal.ipniTimeToIndexMs = timeToIndexMs;
        this.discoverabilityMetrics.observeSpIndexLocallyMs(labels, timeToIndexMs);
      }
    }

    if (finalStatus.advertised && !deal.ipniAdvertisedAt) {
      const advertisedTimestamp = finalStatus.advertisedAt ? new Date(finalStatus.advertisedAt) : now;
      deal.ipniAdvertisedAt = advertisedTimestamp;

      this.discoverabilityMetrics.recordStatus(labels, "sp_announced_advertisement");

      const timeToAdvertiseMs = calculateDuration(advertisedTimestamp, "advertised");
      if (timeToAdvertiseMs) {
        /**
         * Time taken for the SP to advertise the piece to IPNI after upload:
         * time = advertisedAt - uploadEndTime
         */
        deal.ipniTimeToAdvertiseMs = timeToAdvertiseMs;
        this.discoverabilityMetrics.observeSpAnnounceAdvertisementMs(labels, timeToAdvertiseMs);
      }
    }

    // Update verification metrics and timestamp
    // Only set verified timestamp if rootCID was successfully verified
    if (ipniResult.rootCIDVerified && !deal.ipniVerifiedAt) {
      const verifiedTimestamp = new Date(ipniResult.verifiedAt);
      deal.ipniVerifiedAt = verifiedTimestamp;

      const timeToVerifyMs = calculateDuration(verifiedTimestamp, "verified");
      if (timeToVerifyMs) {
        deal.ipniTimeToVerifyMs = timeToVerifyMs;
      }
    }

    deal.ipniVerifiedCidsCount = ipniResult.verified;
    deal.ipniUnverifiedCidsCount = ipniResult.unverified;

    this.logger.log({
      ...dealLogContext,
      event: "ipni_status_updated",
      message: "IPNI status updated",
      ipniStatus: deal.ipniStatus,
      verifiedCids: deal.ipniVerifiedCidsCount,
      totalCids: ipniResult.total,
      unverifiedCids: deal.ipniUnverifiedCidsCount,
      timeToVerifyMs: deal.ipniTimeToVerifyMs ?? null,
    });

    let finalDiscoverabilityStatus = "failure.other";
    if (ipniResult.rootCIDVerified) {
      finalDiscoverabilityStatus = "success";
    } else if (!monitoringResult.success && finalStatus.status === "timeout") {
      finalDiscoverabilityStatus = "failure.timedout";
    }
    this.discoverabilityMetrics.recordStatus(labels, finalDiscoverabilityStatus);

    // Save the updated deal entity
    try {
      await this.dealRepository.save(deal);
    } catch (error) {
      this.logger.error({
        ...dealLogContext,
        event: "save_ipni_metrics_failed",
        message: "Failed to save IPNI metrics",
        error: toStructuredError(error),
      });
      throw error;
    }

    return finalDiscoverabilityStatus;
  }
}
