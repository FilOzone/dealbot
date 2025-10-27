import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CDN_HOSTNAMES } from "../../common/constants.js";
import type { IBlockchainConfig, IConfig } from "../../config/app.config.js";
import { ServiceType } from "../../database/types.js";
import type { IRetrievalAddon } from "../interfaces/retrieval-addon.interface.js";
import type { ExpectedMetrics, RetrievalConfiguration, RetrievalUrlResult, ValidationResult } from "../types.js";
import { RetrievalPriority } from "../types.js";

/**
 * CDN retrieval strategy
 * Retrieves data through Content Delivery Network for fast access
 * Only applicable for deals that were created with CDN enabled
 */
@Injectable()
export class CdnRetrievalStrategy implements IRetrievalAddon {
  private readonly logger = new Logger(CdnRetrievalStrategy.name);

  readonly name = ServiceType.CDN;
  readonly priority = RetrievalPriority.HIGH; // Preferred method due to speed

  // CDN cache warming configuration
  private readonly CDN_RETRIEVAL_ATTEMPTS = 3;
  private readonly CDN_RETRY_DELAY_MS = 10 * 1_000;

  constructor(private readonly configService: ConfigService<IConfig, true>) {}

  /**
   * CDN retrieval is only available if CDN was enabled during deal creation
   */
  canHandle(config: RetrievalConfiguration): boolean {
    // Check if CDN was enabled in deal metadata
    const cdnEnabled = config.deal.metadata?.cdn?.enabled === true;

    if (!cdnEnabled) {
      this.logger.debug(`CDN not available for deal ${config.deal.id}: CDN not enabled during creation`);
      return false;
    }

    // Verify we have required data
    if (!config.walletAddress || !config.deal.pieceCid) {
      this.logger.warn(`CDN not available for deal ${config.deal.id}: missing wallet address or piece CID`);
      return false;
    }

    return true;
  }

  /**
   * Construct CDN URL using wallet address and piece CID
   * Format: https://{walletAddress}.{cdnHostname}/{pieceCid}
   */
  constructUrl(config: RetrievalConfiguration): RetrievalUrlResult {
    const blockchainConfig = this.configService.get<IBlockchainConfig>("blockchain");
    const cdnHostname = CDN_HOSTNAMES[blockchainConfig.network];

    if (!cdnHostname) {
      throw new Error(`CDN hostname not configured for network: ${blockchainConfig.network}`);
    }

    const walletAddress = config.walletAddress.toLowerCase();
    const pieceCid = config.deal.pieceCid;

    // Construct CDN URL
    const url = `https://${walletAddress}.${cdnHostname}/${pieceCid}`;

    this.logger.debug(`Constructed CDN retrieval URL: ${url}`);

    return {
      url,
      method: this.name,
      metadata: {
        cdnHostname,
        walletAddress,
        pieceCid,
        network: blockchainConfig.network,
        retrievalType: ServiceType.CDN,
        cdnProvider: config.deal.metadata?.cdn?.provider || "unknown",
      },
    };
  }

  /**
   * Validate CDN retrieved data
   * CDN should return the original data (or CAR if IPNI was used)
   */
  async validateData(retrievedData: Buffer, config: RetrievalConfiguration): Promise<ValidationResult> {
    const actualSize = retrievedData.length;
    const expectedSize = Number(config.deal.fileSize);

    const isValid = actualSize === expectedSize;

    if (!isValid) {
      this.logger.warn(
        `CDN retrieval size mismatch for deal ${config.deal.id}: ` + `expected ${expectedSize}, got ${actualSize}`,
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
   * CDN retrieval should be very fast due to edge caching
   */
  getExpectedMetrics(): ExpectedMetrics {
    return {
      latencyRange: {
        min: 10, // 10ms minimum (edge cache hit)
        max: 1000, // 1s maximum (cache miss)
      },
      ttfbRange: {
        min: 5, // 5ms minimum
        max: 500, // 500ms maximum
      },
      throughputRange: {
        min: 1024 * 1024 * 10, // 10 MB/s minimum
        max: 1024 * 1024 * 1000, // 1 GB/s maximum (edge network)
      },
    };
  }

  /**
   * CDN retry configuration for cache warming
   * Multiple attempts capture both cache-miss and cache-hit performance
   */
  getRetryConfig(): { attempts: number; delayMs: number } {
    return {
      attempts: this.CDN_RETRIEVAL_ATTEMPTS,
      delayMs: this.CDN_RETRY_DELAY_MS,
    };
  }
}
