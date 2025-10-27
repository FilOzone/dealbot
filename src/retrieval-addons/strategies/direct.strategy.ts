import { Injectable, Logger } from "@nestjs/common";
import { ServiceType } from "../../database/types.js";
import type { WalletSdkService } from "../../wallet-sdk/wallet-sdk.service.js";
import type { IRetrievalAddon } from "../interfaces/retrieval-addon.interface.js";
import type { ExpectedMetrics, RetrievalConfiguration, RetrievalUrlResult, ValidationResult } from "../types.js";
import { RetrievalPriority } from "../types.js";

/**
 * Direct retrieval strategy
 * Retrieves data directly from storage provider's PDP endpoint
 * This is the baseline/fallback method that always works
 */
@Injectable()
export class DirectRetrievalStrategy implements IRetrievalAddon {
  private readonly logger = new Logger(DirectRetrievalStrategy.name);

  readonly name = ServiceType.DIRECT_SP;
  readonly priority = RetrievalPriority.LOW; // Fallback method

  constructor(private readonly walletSdkService: WalletSdkService) {}

  /**
   * Direct retrieval is always available as fallback
   * Works for all deals regardless of add-ons
   */
  canHandle(config: RetrievalConfiguration): boolean {
    // Direct retrieval always works as long as we have a provider
    const providerInfo = this.walletSdkService.getApprovedProviderInfo(config.storageProvider);
    return providerInfo !== undefined && providerInfo.products.PDP !== undefined;
  }

  /**
   * Construct direct retrieval URL from provider's PDP endpoint
   */
  constructUrl(config: RetrievalConfiguration): RetrievalUrlResult {
    const providerInfo = this.walletSdkService.getApprovedProviderInfo(config.storageProvider);

    if (!providerInfo) {
      throw new Error(`Provider ${config.storageProvider} not found in approved providers`);
    }

    if (!providerInfo.products.PDP) {
      throw new Error(`Provider ${config.storageProvider} does not support PDP`);
    }

    const serviceUrl = providerInfo.products.PDP.data.serviceURL;
    const pieceCid = config.deal.pieceCid;

    if (!pieceCid) {
      throw new Error(`Deal ${config.deal.id} does not have a piece CID`);
    }

    // Construct URL: {serviceURL}/piece/{pieceCid}
    const url = `${serviceUrl.replace(/\/$/, "")}/piece/${pieceCid}`;

    this.logger.debug(`Constructed direct retrieval URL: ${url}`);

    return {
      url,
      method: this.name,
      metadata: {
        providerName: providerInfo.name,
        providerAddress: config.storageProvider,
        serviceUrl,
        pieceCid,
        retrievalType: ServiceType.DIRECT_SP,
      },
    };
  }

  /**
   * Validate retrieved data by checking size and basic integrity
   */
  async validateData(retrievedData: Buffer, config: RetrievalConfiguration): Promise<ValidationResult> {
    const expectedSize = Number(config.deal.fileSize);
    const actualSize = retrievedData.length;

    const isValid = actualSize === expectedSize;

    if (!isValid) {
      this.logger.warn(
        `Direct retrieval size mismatch for deal ${config.deal.id}: ` + `expected ${expectedSize}, got ${actualSize}`,
      );
    }

    return {
      isValid,
      method: "size-check",
      details: isValid
        ? `Size matches expected ${expectedSize} bytes`
        : `Size mismatch: expected ${expectedSize}, got ${actualSize}`,
      comparison: {
        expected: expectedSize,
        actual: actualSize,
      },
    };
  }

  /**
   * Direct retrieval typically has moderate latency
   * Depends on provider's infrastructure and network conditions
   */
  getExpectedMetrics(): ExpectedMetrics {
    return {
      latencyRange: {
        min: 100, // 100ms minimum
        max: 5000, // 5s maximum
      },
      ttfbRange: {
        min: 50, // 50ms minimum
        max: 2000, // 2s maximum
      },
      throughputRange: {
        min: 1024 * 100, // 100 KB/s minimum
        max: 1024 * 1024 * 100, // 100 MB/s maximum
      },
    };
  }
}
