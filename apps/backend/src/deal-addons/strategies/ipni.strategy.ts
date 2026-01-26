import { METADATA_KEYS, PDPServer, type ProviderInfo } from "@filoz/synapse-sdk";
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { waitForIpniProviderResults } from "filecoin-pin/core/utils";
import { CID } from "multiformats/cid";
import { StorageProvider } from "src/database/entities/storage-provider.entity.js";
import type { Repository } from "typeorm";
import { buildUnixfsCar } from "../../common/car-utils.js";
import { Deal } from "../../database/entities/deal.entity.js";
import type { DealMetadata, IpniMetadata } from "../../database/types.js";
import { IpniStatus, ServiceType } from "../../database/types.js";
import type { IDealAddon } from "../interfaces/deal-addon.interface.js";
import type { AddonExecutionContext, DealConfiguration, IpniPreprocessingResult, SynapseConfig } from "../types.js";
import { AddonPriority } from "../types.js";
import type {
  IPNIVerificationResult,
  MonitorAndVerifyResult,
  PieceMonitoringResult,
  PieceStatus,
} from "./ipni.types.js";

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
          // we don't need the other fields for IPNI verification
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
  ) {}

  readonly name = ServiceType.IPFS_PIN;
  readonly priority = AddonPriority.HIGH; // Run first to transform data
  readonly POLLING_INTERVAL_MS = 2500;
  readonly POLLING_TIMEOUT_MS = 10 * 60 * 1000;
  readonly IPNI_LOOKUP_TIMEOUT_MS = 60 * 60 * 1000;
  readonly IPNI_VERIFICATION_DELAY_MS = 30 * 1000; // Wait 30s after retrieve request before verifying
  readonly IPNI_VERIFICATION_RETRY_INTERVAL_MS = 10 * 1000;

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
  async preprocessData(context: AddonExecutionContext): Promise<IpniPreprocessingResult> {
    try {
      const carResult = await buildUnixfsCar(context.currentData);

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
   * Starts IPNI tracking and monitoring in the background
   */
  async onUploadComplete(deal: Deal): Promise<void> {
    if (!deal.storageProvider) {
      this.logger.warn(`No storage provider for deal ${deal.id}`);
      return;
    }

    // Set initial IPNI status to pending
    deal.ipniStatus = IpniStatus.PENDING;
    await this.dealRepository.save(deal);

    this.logger.log(`IPNI tracking started: ${deal.pieceCid?.slice(0, 12)}...`);

    // Start monitoring asynchronously (don't await)
    this.startIpniMonitoring(deal).catch((error) => {
      this.logger.error(`IPNI monitoring failed: ${error.message}`);
    });
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
  private async startIpniMonitoring(deal: Deal): Promise<void> {
    if (!deal.storageProvider) {
      // this should never happen, we need to tighten up the types for successful deals.
      this.logger.warn(`No storage provider for deal ${deal.id}`);
      return;
    }

    try {
      const serviceUrl = deal.storageProvider.serviceUrl;
      const pdpServer = new PDPServer(null, serviceUrl);

      const rootCID = deal.metadata[this.name]?.rootCID ?? "";
      const blockCIDs = deal.metadata[this.name]?.blockCIDs ?? [];

      const result = await this.monitorAndVerifyIPNI(
        pdpServer,
        deal,
        blockCIDs.map((cid) => CID.parse(cid)),
        rootCID,
        deal.storageProvider,
        this.POLLING_TIMEOUT_MS,
        this.IPNI_LOOKUP_TIMEOUT_MS,
        this.POLLING_INTERVAL_MS,
      );

      // Update deal entity with tracking metrics
      await this.updateDealWithIpniMetrics(deal, result);
    } catch (error) {
      // Mark IPNI as failed and save to database
      deal.ipniStatus = IpniStatus.FAILED;

      try {
        await this.dealRepository.save(deal);
        this.logger.warn(`IPNI failed: ${deal.pieceCid?.slice(0, 12)}... - ${error.message}`);
      } catch (saveError) {
        this.logger.error(`Failed to save IPNI failure status: ${saveError.message}`);
      }

      // Re-throw to be caught by onUploadComplete handler
      throw error;
    }
  }

  async monitorAndVerifyIPNI(
    pdpServer: PDPServer,
    deal: Deal,
    blockCIDs: CID[],
    rootCID: string,
    storageProvider: StorageProvider,
    statusTimeoutMs: number,
    ipniTimeoutMs: number,
    pollIntervalMs: number,
  ): Promise<MonitorAndVerifyResult> {
    const startTime = Date.now();
    const pieceCid = deal.pieceCid;
    let monitoringResult: PieceMonitoringResult;
    try {
      monitoringResult = await this.monitorPieceStatus(pdpServer, pieceCid, statusTimeoutMs, pollIntervalMs);
    } catch (error) {
      this.logger.warn(`Piece status monitoring incomplete: ${error.message}`);
      monitoringResult = {
        success: false,
        finalStatus: {
          status: "timeout",
          indexed: false,
          advertised: false,
          retrieved: false,
          retrievedAt: null,
          indexedAt: null,
          advertisedAt: null,
        },
        checks: 0,
        durationMs: statusTimeoutMs,
      };
    }

    // Wait after sp_received_retrieve_request to allow IPNI indexer time to process
    if (monitoringResult.finalStatus.retrieved) {
      this.logger.log(`Waiting ${this.IPNI_VERIFICATION_DELAY_MS / 1000}s for IPNI indexer to process CIDs...`);
      await new Promise((resolve) => setTimeout(resolve, this.IPNI_VERIFICATION_DELAY_MS));
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

    this.logger.log(`Verifying rootCID in IPNI: ${rootCID.slice(0, 12)}...`);

    // NOTE: filecoin-pin does not currently validate that all blocks are advertised on IPNI.
    const ipniValidated = await waitForIpniProviderResults(rootCidObj, {
      childBlocks: blockCIDs,
      maxAttempts,
      delayMs: ATTEMPT_INTERVAL_MS,
      expectedProviders: [buildExpectedProviderInfo(storageProvider)],
    }).catch((error) => {
      this.logger.warn(`IPNI verification failed: ${error.message}`);
      return false;
    });

    const durationMs = Date.now() - startTime;

    // We only verify rootCID (not individual block CIDs)
    const ipniResult: IPNIVerificationResult = {
      verified: ipniValidated ? 1 : 0,
      unverified: ipniValidated ? 0 : 1,
      total: 1,
      rootCIDVerified: ipniValidated,
      durationMs,
      failedCIDs: ipniValidated
        ? []
        : [{ cid: rootCID, reason: "IPNI did not return expected provider results via filecoin-pin" }],
      verifiedAt: new Date().toISOString(),
    };

    if (ipniValidated) {
      this.logger.log(`IPNI verified: rootCID ${rootCID.slice(0, 12)}... (${(durationMs / 1000).toFixed(1)}s)`);
    } else {
      this.logger.warn(`IPNI verification failed for rootCID: ${rootCID.slice(0, 12)}...`);
    }

    return {
      monitoringResult,
      ipniResult,
    };
  }

  async monitorPieceStatus(
    pdpServer: PDPServer,
    pieceCid: string,
    maxDurationMs: number,
    pollIntervalMs: number,
  ): Promise<PieceMonitoringResult> {
    const startTime = Date.now();
    let lastStatus: PieceStatus = {
      status: "",
      indexed: false,
      advertised: false,
      retrieved: false,
      retrievedAt: null,
      indexedAt: null,
      advertisedAt: null,
    };
    let checkCount = 0;

    while (Date.now() - startTime < maxDurationMs) {
      checkCount++;

      try {
        const sdkStatus = await pdpServer.getPieceStatus(pieceCid);

        const currentStatus: PieceStatus = {
          status: sdkStatus.status,
          indexed: sdkStatus.indexed,
          advertised: sdkStatus.advertised,
          retrieved: sdkStatus.retrieved,
          retrievedAt: sdkStatus.retrievedAt, // retrievedAt is optional from sdk
          // sdkStatus does not provide these fields, so we use the last known values
          indexedAt: lastStatus.indexedAt,
          advertisedAt: lastStatus.advertisedAt,
        };

        // Update indexedAt and advertisedAt if they have changed
        if (currentStatus.indexed && !lastStatus.indexed) {
          currentStatus.indexedAt = new Date().toISOString();
          this.logger.log(`Piece indexed: ${pieceCid.slice(0, 12)}...`);
        }

        if (currentStatus.advertised && !lastStatus.advertised) {
          currentStatus.advertisedAt = new Date().toISOString();
          this.logger.log(`Piece advertised: ${pieceCid.slice(0, 12)}...`);
        }

        // Return if status has changed to retrieved
        if (currentStatus.retrieved && !lastStatus.retrieved) {
          // sdk can return undefined for retrievedAt, so we use the current time
          currentStatus.retrievedAt = currentStatus.retrievedAt ?? new Date().toISOString();

          const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
          this.logger.log(`Piece retrieved: ${pieceCid.slice(0, 12)}... (${durationSec}s)`);
          return {
            success: true,
            finalStatus: currentStatus,
            checks: checkCount,
            durationMs: Date.now() - startTime,
          };
        }

        lastStatus = currentStatus;
      } catch (error) {
        if (checkCount % 20 === 0) {
          this.logger.debug(`Status check error: ${error.message}`);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    // Timeout reached
    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
    this.logger.warn(`Piece retrieval timeout: ${pieceCid.slice(0, 12)}... (${durationSec}s)`);
    throw new Error(`Timeout waiting for piece retrieval after ${durationSec}s`);
  }

  /**
   * Update deal entity with IPNI tracking metrics
   */
  private async updateDealWithIpniMetrics(deal: Deal, result: MonitorAndVerifyResult): Promise<void> {
    const { monitoringResult, ipniResult } = result;
    const { finalStatus } = monitoringResult;
    const now = new Date();
    const uploadEndTime = deal.uploadEndTime;

    // Determine IPNI status based on progression
    // Terminal state is VERIFIED when rootCID (minimum) is verified via filecoinpin.contact
    // The rootCID must be verified for the deal to be considered verified
    if (ipniResult.rootCIDVerified) {
      deal.ipniStatus = IpniStatus.VERIFIED;
    } else if (finalStatus.retrieved) {
      deal.ipniStatus = IpniStatus.SP_RECEIVED_RETRIEVE_REQUEST;
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

      const timeToIndexMs = calculateDuration(indexedTimestamp, "indexed");
      if (timeToIndexMs) {
        deal.ipniTimeToIndexMs = timeToIndexMs;
      }
    }

    if (finalStatus.advertised && !deal.ipniAdvertisedAt) {
      const advertisedTimestamp = finalStatus.advertisedAt ? new Date(finalStatus.advertisedAt) : now;
      deal.ipniAdvertisedAt = advertisedTimestamp;

      const timeToAdvertiseMs = calculateDuration(advertisedTimestamp, "advertised");
      if (timeToAdvertiseMs) {
        deal.ipniTimeToAdvertiseMs = timeToAdvertiseMs;
      }
    }

    if (finalStatus.retrieved && !deal.ipniRetrievedAt) {
      const retrievedTimestamp = finalStatus.retrievedAt ? new Date(finalStatus.retrievedAt) : now;
      deal.ipniRetrievedAt = retrievedTimestamp;

      const timeToRetrieveMs = calculateDuration(retrievedTimestamp, "retrieved");
      if (timeToRetrieveMs) {
        deal.ipniTimeToRetrieveMs = timeToRetrieveMs;
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
      `IPNI ${deal.ipniStatus}: ${deal.pieceCid?.slice(0, 12)}... ` +
        `(${timeToVerifySec}s, ${deal.ipniVerifiedCidsCount}/${ipniResult.total} CIDs verified, ${deal.ipniUnverifiedCidsCount} unverified)`,
    );

    // Save the updated deal entity
    try {
      await this.dealRepository.save(deal);
    } catch (error) {
      this.logger.error(`Failed to save IPNI metrics: ${error.message}`);
      throw error;
    }
  }
}
