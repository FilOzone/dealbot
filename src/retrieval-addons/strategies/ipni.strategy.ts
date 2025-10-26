import { Injectable, Logger } from "@nestjs/common";
import type { IRetrievalAddon } from "../interfaces/retrieval-addon.interface.js";
import type { RetrievalConfiguration, RetrievalUrlResult, ValidationResult, ExpectedMetrics } from "../types.js";
import { RetrievalPriority, RetrievalMethod } from "../types.js";
import { WalletSdkService } from "../../wallet-sdk/wallet-sdk.service.js";

/**
 * IPNI (InterPlanetary Network Indexer) retrieval strategy
 * Retrieves data through IPFS network using the root CID from CAR file
 * Only applicable for deals that were created with IPNI enabled
 */
@Injectable()
export class IpniRetrievalStrategy implements IRetrievalAddon {
  private readonly logger = new Logger(IpniRetrievalStrategy.name);

  readonly name = RetrievalMethod.IPNI;
  readonly priority = RetrievalPriority.MEDIUM; // Alternative method

  constructor(private readonly walletSdkService: WalletSdkService) {}

  /**
   * IPNI retrieval is only available if IPNI was enabled during deal creation
   */
  canHandle(config: RetrievalConfiguration): boolean {
    // Check if IPNI was enabled in deal metadata
    const ipniEnabled = config.deal.metadata?.ipni?.ipniEnabled === true;

    if (!ipniEnabled) {
      this.logger.debug(`IPNI not available for deal ${config.deal.id}: IPNI not enabled during creation`);
      return false;
    }

    // Verify we have the root CID
    const rootCID = config.deal.metadata?.ipni?.rootCID;
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
    const rootCID = config.deal.metadata?.ipni?.rootCID;

    if (!rootCID) {
      throw new Error(`Deal ${config.deal.id} does not have IPNI root CID`);
    }

    const providerInfo = this.walletSdkService.getApprovedProviderInfo(config.storageProvider);

    if (!providerInfo) {
      throw new Error(`Provider ${config.storageProvider} not found in approved providers`);
    }

    if (!providerInfo.products.PDP) {
      throw new Error(`Provider ${config.storageProvider} does not support PDP`);
    }

    const serviceUrl = providerInfo.products.PDP.data.serviceURL;
    const url = `${serviceUrl.replace(/\/$/, "")}/piece/${rootCID}`;

    this.logger.debug(`Constructed IPNI retrieval URL: ${url}`);

    return {
      url,
      method: this.name,
      metadata: {
        rootCID,
        blockCount: config.deal.metadata?.ipni?.blockCount,
        carSize: config.deal.metadata?.ipni?.carSize,
        retrievalType: "ipni",
      },
    };
  }

  /**
   * Validate IPNI retrieved data
   * IPNI returns the original data (extracted from CAR blocks)
   */
  async validateData(retrievedData: Buffer, config: RetrievalConfiguration): Promise<ValidationResult> {
    const expectedSize = config.deal.fileSize;
    const actualSize = retrievedData.length;

    // IPNI should return the original data size (not CAR)
    // The IPFS gateway extracts the data from CAR blocks
    const isValid = actualSize === expectedSize;

    if (!isValid) {
      this.logger.warn(
        `IPNI retrieval size mismatch for deal ${config.deal.id}: ` + `expected ${expectedSize}, got ${actualSize}`,
      );
    }

    const blockCIDs = config.deal.metadata?.ipni?.blockCIDs;
    const blockCount = config.deal.metadata?.ipni?.blockCount;

    let additionalDetails = "";
    if (blockCIDs && blockCount) {
      additionalDetails = ` (${blockCount} blocks in CAR)`;
    }

    return {
      isValid,
      method: "size-check",
      details: isValid
        ? `Size matches expected ${expectedSize} bytes${additionalDetails}`
        : `Size mismatch: expected ${expectedSize}, got ${actualSize}${additionalDetails}`,
      comparison: {
        expected: expectedSize,
        actual: actualSize,
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
