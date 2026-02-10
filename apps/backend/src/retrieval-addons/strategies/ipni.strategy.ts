import { Injectable, Logger } from "@nestjs/common";
import { validateCarContent } from "../../common/car-utils.js";
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
   * 1. Fast size pre-check against expected CAR size
   * 2. Full content validation: unpack CAR → rebuild → compare root CIDs
   */
  async validateData(retrievedData: Buffer, config: RetrievalConfiguration): Promise<ValidationResult> {
    const actualSize = retrievedData.length;
    const carSize = config.deal.metadata?.[this.name]?.carSize;
    const originalSize = config.deal.metadata?.[this.name]?.originalSize;

    const rootCIDStr = config.deal.metadata?.[this.name]?.rootCID;
    const blockCIDs = config.deal.metadata?.[this.name]?.blockCIDs;
    const blockCount = config.deal.metadata?.[this.name]?.blockCount;
    const storageProvider = config.storageProvider;

    // Early return if carSize metadata is missing - cannot validate
    if (carSize === undefined || carSize === null) {
      this.logger.warn(
        `IPNI validation skipped for deal ${config.deal.id}: carSize metadata is missing. ` +
          `Retrieved ${actualSize} bytes from ${storageProvider}`,
      );
      return {
        isValid: false,
        method: "car-content-validation",
        details: `Cannot validate: carSize metadata is missing. Retrieved ${actualSize} bytes`,
        comparison: { expected: undefined, actual: actualSize },
      };
    }

    const expectedCarSize = Number(carSize);

    // fast size pre-check — fail immediately on size mismatch
    if (actualSize !== expectedCarSize) {
      const sizeDiff = actualSize - expectedCarSize;
      const sizeDiffPercent = expectedCarSize > 0 ? ((sizeDiff / expectedCarSize) * 100).toFixed(2) : "N/A";

      const logParts = [
        `IPNI retrieval validation failed for deal ${config.deal.id}:`,
        `  Storage Provider: ${String(storageProvider)}`,
        rootCIDStr ? `  Expected Root CID: ${rootCIDStr}` : "  Expected Root CID: missing",
        `  Retrieved Data Size: ${actualSize} bytes`,
        `  Expected CAR File Size: ${expectedCarSize} bytes (from metadata.carSize)`,
        originalSize ? `  Original File Size: ${originalSize} bytes (for reference)` : null,
        `  Size Difference: ${sizeDiff > 0 ? "+" : ""}${sizeDiff} bytes (${sizeDiffPercent}%)`,
        blockCount ? `  Block Count in CAR: ${blockCount}` : "  Block Count: missing",
        blockCIDs ? `  Block CIDs in CAR: ${blockCIDs.length} entries` : "  Block CIDs: missing",
        blockCIDs && blockCIDs.length > 0 ? `  First Block CID (rootCID): ${blockCIDs[0]}` : null,
      ].filter((part): part is string => part !== null);

      this.logger.warn(logParts.join("\n"));

      let additionalDetails = "";
      if (blockCIDs && blockCount) {
        additionalDetails = ` (${blockCount} blocks in CAR)`;
      }

      return {
        isValid: false,
        method: "car-content-validation",
        details: `CAR size mismatch: expected ${expectedCarSize}, got ${actualSize}${additionalDetails}`,
        comparison: {
          expected: expectedCarSize,
          actual: actualSize,
        },
      };
    }

    // full content validation — unpack, rebuild, compare root CIDs
    if (!rootCIDStr) {
      this.logger.warn(
        `IPNI content validation skipped for deal ${config.deal.id}: rootCID metadata is missing. ` +
          `Size check passed (${actualSize} bytes)`,
      );
      return {
        isValid: true,
        method: "car-content-validation",
        details: `CAR size matches expected ${expectedCarSize} bytes but content validation skipped (rootCID missing)`,
        comparison: {
          expected: expectedCarSize,
          actual: actualSize,
        },
      };
    }

    const validationResult = await validateCarContent(retrievedData, rootCIDStr);

    if (!validationResult.isValid) {
      this.logger.warn(
        `IPNI content validation failed for deal ${config.deal.id} from ${storageProvider}: ${validationResult.details}`,
      );
    }

    return {
      isValid: validationResult.isValid,
      method: "car-content-validation",
      details: validationResult.details,
      comparison: {
        expected: rootCIDStr,
        actual: validationResult.rebuiltRootCID ?? "unknown",
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
