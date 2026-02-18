import { METADATA_KEYS, type ProviderInfo } from "@filoz/synapse-sdk";
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { waitForIpniProviderResults } from "filecoin-pin/core/utils";
import { CID } from "multiformats/cid";
import { StorageProvider } from "src/database/entities/storage-provider.entity.js";
import type { Repository } from "typeorm";
import { delay } from "../../common/abort-utils.js";
import { buildUnixfsCar } from "../../common/car-utils.js";
import { Deal } from "../../database/entities/deal.entity.js";
import type { DealMetadata, IpniMetadata } from "../../database/types.js";
import { IpniStatus, ServiceType } from "../../database/types.js";
import { HttpClientService } from "../../http-client/http-client.service.js";
import { classifyFailureStatus } from "../../metrics/utils/check-metric-labels.js";
import { DiscoverabilityCheckMetrics } from "../../metrics/utils/check-metrics.service.js";

import type { IDealAddon } from "../interfaces/deal-addon.interface.js";
import type { AddonExecutionContext, DealConfiguration, IpniPreprocessingResult, SynapseConfig } from "../types.js";
import { AddonPriority } from "../types.js";
import type {
  IPNIVerificationResult,
  MonitorAndVerifyResult,
  PieceMonitoringResult,
  PieceStatus,
  PieceStatusResponse,
} from "./ipni.types.js";
import { validatePieceStatusResponse } from "./ipni.types.js";

/**
 * Convert from a dealbot StorageProvider to a synapse-sdk ProviderInfo object
 */
function buildExpectedProviderInfo(storageProvider: StorageProvider): ProviderInfo {
  return {
    id: storageProvider.providerId ?? (0 as number),
    serviceProvider: storageProvider.address,
    payee: storageProvider.payee,
    name: storageProvider.name,
    description: storageProvider.description,
    active: storageProvider.isActive,
    products: {
      PDP: {
        type: "PDP",
        isActive: true,
        capabilities: {},
        data: {
          serviceURL: storageProvider.serviceUrl,
          // We don't need the other fields for IPNI verification.
        } as any,
      },
    },
  };
}

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
  ) {}

  readonly name = ServiceType.IPFS_PIN;
  readonly priority = AddonPriority.HIGH; // Run first to transform data
  readonly POLLING_INTERVAL_MS = 2500;
  readonly POLLING_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes - max time to wait for SP to advertise piece
  readonly IPNI_LOOKUP_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes - max time to wait for IPNI propagation

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

      this.logger.log(`CAR conversion: ${carResult.blockCount} blocks, ${(carResult.carSize / 1024).toFixed(1)}KB`);

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
      this.logger.error(`CAR conversion failed: ${error.message}`);
      throw new Error(`IPNI preprocessing failed: ${error.message}`);
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
  async onUploadComplete(deal: Deal, signal?: AbortSignal): Promise<void> {
    if (!deal.storageProvider) {
      this.logger.warn(`No storage provider for deal ${deal.id}`);
      return;
    }

    // Set initial IPNI status to pending
    deal.ipniStatus = IpniStatus.PENDING;
    await this.dealRepository.save(deal);
    this.discoverabilityMetrics.recordStatus(this.discoverabilityMetrics.buildLabelsForDeal(deal), "pending");

    signal?.throwIfAborted();

    this.logger.log(`IPNI tracking started: ${deal.pieceCid}`);

    await this.startIpniMonitoring(deal, signal);
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
  private async startIpniMonitoring(deal: Deal, signal?: AbortSignal): Promise<void> {
    if (!deal.storageProvider) {
      // this should never happen, we need to tighten up the types for successful deals.
      this.logger.warn(`No storage provider for deal ${deal.id}`);
      return;
    }

    let finalDiscoverabilityStatus: string | null = null;
    try {
      signal?.throwIfAborted();
      const serviceUrl = deal.storageProvider.serviceUrl;

      const rootCID = deal.metadata[this.name]?.rootCID ?? "";
      const blockCIDs = deal.metadata[this.name]?.blockCIDs ?? [];

      const result = await this.monitorAndVerifyIPNI(
        serviceUrl,
        deal,
        blockCIDs.map((cid) => CID.parse(cid)),
        rootCID,
        deal.storageProvider,
        this.POLLING_TIMEOUT_MS,
        this.IPNI_LOOKUP_TIMEOUT_MS,
        this.POLLING_INTERVAL_MS,
        signal,
      );

      signal?.throwIfAborted();

      // Update deal entity with tracking metrics
      finalDiscoverabilityStatus = await this.updateDealWithIpniMetrics(deal, result);

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
        this.logger.warn(`IPNI failed: ${deal.pieceCid} - ${error.message}`);
      } catch (saveError) {
        this.logger.error(`Failed to save IPNI failure status: ${saveError.message}`);
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
    signal?: AbortSignal,
  ): Promise<MonitorAndVerifyResult> {
    const pieceCid = deal.pieceCid;
    let monitoringResult: PieceMonitoringResult;
    try {
      // we monitor the piece status by calling the SP directly to get piece status. as soon as it's advertised, we can move on to verifying the IPNI advertisement.
      monitoringResult = await this.monitorPieceStatus(serviceURL, pieceCid, statusTimeoutMs, pollIntervalMs, signal);
    } catch (error) {
      signal?.throwIfAborted();
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Piece status monitoring incomplete: ${errorMessage}`);
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

    const rootCidObj = CID.parse(rootCID);

    if (!rootCidObj || blockCIDs.length === 0) {
      this.logger.warn(`No rootCID or blockCIDs for deal ${deal.id}`);
      return {
        monitoringResult,
        ipniResult: {
          verified: 0,
          unverified: 0,
          total: blockCIDs.length + (rootCidObj ? 1 : 0),
          rootCIDVerified: false,
          durationMs: Infinity, // what is the right value here...
          failedCIDs: [rootCidObj, ...blockCIDs].map((cid) => ({
            cid: cid.toString(),
            reason: "No rootCID or blockCIDs for deal",
          })),
          verifiedAt: new Date().toISOString(),
        },
      };
    }
    const ATTEMPT_INTERVAL_MS = 5000;
    const ATTEMPT_MULTIPLIER = 2;
    // Derive maxAttempts from total IPNI timeout, per-attempt interval and a multiplier.
    const maxAttempts = Math.ceil(ipniTimeoutMs / ATTEMPT_INTERVAL_MS / ATTEMPT_MULTIPLIER);

    this.logger.log(`Verifying rootCID in IPNI: ${rootCID}`);

    const ipniVerificationStartTime = Date.now();

    // NOTE: filecoin-pin does not currently validate that all blocks are advertised on IPNI.
    const ipniValidated = await waitForIpniProviderResults(rootCidObj, {
      childBlocks: blockCIDs,
      maxAttempts,
      delayMs: ATTEMPT_INTERVAL_MS,
      expectedProviders: [buildExpectedProviderInfo(storageProvider)],
      signal,
    }).catch((error) => {
      signal?.throwIfAborted();
      this.logger.warn(`IPNI verification failed: ${error.message}`);
      return false;
    });

    const ipniVerificationDurationMs = Date.now() - ipniVerificationStartTime;

    // We only verify rootCID (not individual block CIDs)
    const ipniResult: IPNIVerificationResult = {
      verified: ipniValidated ? 1 : 0,
      unverified: ipniValidated ? 0 : 1,
      total: 1,
      rootCIDVerified: ipniValidated,
      durationMs: ipniVerificationDurationMs,
      failedCIDs: ipniValidated
        ? []
        : [{ cid: rootCID, reason: "IPNI did not return expected provider results via filecoin-pin" }],
      verifiedAt: new Date().toISOString(),
    };

    this.discoverabilityMetrics.observeIpniVerifyMs(
      this.discoverabilityMetrics.buildLabelsForDeal(deal),
      ipniVerificationDurationMs,
    );

    if (ipniValidated) {
      this.logger.log(`IPNI verified: rootCID ${rootCID} (${(ipniVerificationDurationMs / 1000).toFixed(1)}s)`);
    } else {
      this.logger.warn(`IPNI verification failed for rootCID: ${rootCID}`);
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
        const sdkStatus = await this.getPieceStatus(serviceURL, pieceCid, signal);
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
            this.logger.log(`Piece indexed: ${pieceCid}`);
          }
        }

        // Return as soon as status has changed to advertised
        if (currentStatus.advertised && !currentStatus.advertisedAt) {
          currentStatus.advertisedAt = new Date().toISOString();
          if (!lastStatus.advertised) {
            this.logger.log(`Piece advertised: ${pieceCid}`);
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
          this.logger.debug(`Status check error: ${error.message}`);
        }
      }

      await delay(pollIntervalMs, signal);
    }

    // Timeout reached
    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
    this.logger.warn(`Piece retrieval timeout: ${pieceCid} (${durationSec}s)`);
    throw new Error(`Timeout waiting for piece retrieval after ${durationSec}s`);
  }

  /**
   * Get indexing and IPNI status for a piece from PDP server
   */
  private async getPieceStatus(
    serviceURL: string,
    pieceCid: string,
    signal?: AbortSignal,
  ): Promise<PieceStatusResponse> {
    if (!pieceCid || typeof pieceCid !== "string") {
      throw new Error(`Invalid PieceCID: ${String(pieceCid)}`);
    }

    const url = `${serviceURL}/pdp/piece/${pieceCid}/status`;
    this.logger.debug(`Getting piece status from ${url}`);

    try {
      const { data } = await this.httpClientService.requestWithoutProxyAndMetrics<Buffer>(url, {
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
          this.logger.warn(`Failed to get piece status for ${pieceCid}: ${message}`);
          throw new Error(message);
        }
        const statusText = errorResponse.statusText ?? "";
        const message = `Failed to get piece status: ${errorResponse.status} ${statusText} - ${errorText}`;
        this.logger.warn(`Failed to get piece status for ${pieceCid}: ${message}`);
        throw new Error(message);
      }

      this.logger.warn(`Failed to get piece status for ${pieceCid}: ${error.message}`);
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
  private async updateDealWithIpniMetrics(deal: Deal, result: MonitorAndVerifyResult): Promise<string> {
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
        this.logger.warn(
          `Invalid duration for ${eventName}: ${duration}ms (eventTime: ${eventTime.toISOString()}, uploadEndTime: ${uploadEndTime.toISOString()})`,
        );
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

    const timeToVerifySec = deal.ipniTimeToVerifyMs ? (deal.ipniTimeToVerifyMs / 1000).toFixed(1) : "N/A";
    this.logger.log(
      `IPNI ${deal.ipniStatus}: ${deal.pieceCid} ` +
        `(${timeToVerifySec}s, ${deal.ipniVerifiedCidsCount}/${ipniResult.total} CIDs verified, ${deal.ipniUnverifiedCidsCount} unverified)`,
    );

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
      this.logger.error(`Failed to save IPNI metrics: ${error.message}`);
      throw error;
    }

    return finalDiscoverabilityStatus;
  }
}
