import { Injectable, Logger } from "@nestjs/common";
import { validateCarContentStream } from "../../common/car-utils.js";
import { closeStream } from "../../common/stream-utils.js";
import { ServiceType } from "../../database/types.js";
import { WalletSdkService } from "../../wallet-sdk/wallet-sdk.service.js";
import type { IRetrievalAddon } from "../interfaces/retrieval-addon.interface.js";
import type { ExpectedMetrics, RetrievalConfiguration, RetrievalUrlResult, ValidationResult } from "../types.js";
import { RetrievalPriority } from "../types.js";

/**
 * IPNI (InterPlanetary Network Indexer) retrieval strategy
 * Retrieves data through IPFS network using the root CID from CAR file
 * Only applicable for deals that were created with IPNI enabled
 */
@Injectable()
export class IpniRetrievalStrategy implements IRetrievalAddon {
  private readonly logger = new Logger(IpniRetrievalStrategy.name);
  private readonly validationMethods = {
    metadataMissing: "metadata-missing",
    carContentValidation: "car-content-validation",
  } as const;

  readonly name = ServiceType.IPFS_PIN;
  readonly priority = RetrievalPriority.MEDIUM; // Alternative method

  constructor(private readonly walletSdkService: WalletSdkService) {}

  /**
   * IPNI retrieval is only available if IPNI was enabled during deal creation
   */
  canHandle(config: RetrievalConfiguration): boolean {
    // Check if IPNI was enabled in deal metadata
    const ipniEnabled = config.deal.metadata?.[this.name]?.enabled === true;

    if (!ipniEnabled) {
      this.logger.debug(`IPNI not available for deal ${config.deal.id}: IPNI not enabled during creation`);
      return false;
    }

    // Verify we have the root CID
    const rootCID = config.deal.metadata?.[this.name]?.rootCID;
    if (!rootCID) {
      this.logger.warn(`IPNI not available for deal ${config.deal.id}: missing root CID`);
      return false;
    }

    return true;
  }

  /**
   * Construct IPNI retrieval URL using root CID from CAR file
   * Uses IPFS gateway to retrieve data
   */
  constructUrl(config: RetrievalConfiguration): RetrievalUrlResult {
    const rootCID = config.deal.metadata?.[this.name]?.rootCID;

    if (!rootCID) {
      throw new Error(`Deal ${config.deal.id} does not have IPNI root CID`);
    }

    const providerInfo = this.walletSdkService.getProviderInfo(config.storageProvider);

    if (!providerInfo) {
      throw new Error(`Provider ${config.storageProvider} not found in approved providers`);
    }

    if (!providerInfo.products.PDP) {
      throw new Error(`Provider ${config.storageProvider} does not support PDP`);
    }

    const serviceUrl = providerInfo.products.PDP.data.serviceURL;
    const url = `${serviceUrl.replace(/\/$/, "")}/ipfs/${rootCID}`;
    const headers = {
      Accept: "application/vnd.ipld.car",
    };

    this.logger.debug(`Constructed IPNI retrieval URL: ${url}`);

    return {
      url,
      method: this.name,
      headers,
      httpVersion: "2",
    };
  }

  /**
   * Validate IPNI retrieved data
   * The PDP provider returns a CAR file. We perform two validation steps:
   * 1. Size check against expected CAR size (after streaming)
   * 2. Full content validation: stream CAR blocks and verify each block's multihash against its CID,
   *    ensuring the expected root CID (and block set) from metadata is present.
   */
  async validateDataStream(
    stream: AsyncIterable<Uint8Array>,
    config: RetrievalConfiguration,
  ): Promise<ValidationResult> {
    const rootCIDStr = config.deal.metadata?.[this.name]?.rootCID;
    const storageProvider = config.storageProvider;

    if (!rootCIDStr) {
      await closeStream(stream);
      this.logger.warn(
        `IPNI content validation failed for deal ${config.deal.id}: rootCID metadata is missing. ` +
          `Cannot perform content validation.`,
      );
      return {
        isValid: false,
        method: this.validationMethods.metadataMissing,
        details: "Cannot validate: rootCID metadata is missing",
      };
    }

    const validationResult = await validateCarContentStream(stream, rootCIDStr);

    if (!validationResult.isValid) {
      this.logger.warn(
        `IPNI content validation failed for deal ${config.deal.id} from ${storageProvider}: ${validationResult.details}`,
      );
    }

    return {
      isValid: validationResult.isValid,
      method: this.validationMethods.carContentValidation,
      details: validationResult.details,
      comparison: {
        expected: rootCIDStr,
        actual: validationResult.verifiedRootCID ?? "unknown",
      },
    };
  }

  /**
   * IPNI retrieval typically has moderate to high latency
   * Depends on IPFS network conditions and gateway performance
   */
  getExpectedMetrics(): ExpectedMetrics {
    return {
      latencyRange: {
        min: 200, // 200ms minimum
        max: 10000, // 10s maximum (IPFS can be slow)
      },
      ttfbRange: {
        min: 100, // 100ms minimum
        max: 5000, // 5s maximum
      },
      throughputRange: {
        min: 1024 * 50, // 50 KB/s minimum
        max: 1024 * 1024 * 50, // 50 MB/s maximum
      },
    };
  }
}
