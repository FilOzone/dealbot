import { Injectable, Logger } from "@nestjs/common";
import { validateBlock } from "@web3-storage/car-block-validator";
import { CID } from "multiformats/cid";
import { ServiceType } from "../../database/types.js";
import { HttpClientService } from "../../http-client/http-client.service.js";
import { WalletSdkService } from "../../wallet-sdk/wallet-sdk.service.js";
import type { IRetrievalAddon } from "../interfaces/retrieval-addon.interface.js";
import type { ExpectedMetrics, RetrievalConfiguration, RetrievalUrlResult, ValidationResult } from "../types.js";
import { RetrievalPriority } from "../types.js";

/**
 * IPNI (InterPlanetary Network Indexer) retrieval strategy.
 *
 * Terminology:
 * - **IPNI** = the index that lists the SP as a provider for content (we do not call an "IPNI URL" here).
 * - **SP endpoint** = the storage provider's content gateway; we call this to fetch blocks (GET /ipfs/<cid>).
 *
 * This strategy validates that the SP serves the root CID and all DAG block CIDs (stored at deal creation)
 * by fetching each block from the **SP endpoint** with Accept: application/vnd.ipld.raw. No CAR involved.
 */
@Injectable()
export class IpniRetrievalStrategy implements IRetrievalAddon {
  private readonly logger = new Logger(IpniRetrievalStrategy.name);
  private readonly validationMethods = {
    metadataMissing: "metadata-missing",
    blockFetch: "block-fetch",
  } as const;

  readonly name = ServiceType.IPFS_PIN;
  readonly priority = RetrievalPriority.MEDIUM; // Alternative method

  constructor(
    private readonly walletSdkService: WalletSdkService,
    private readonly httpClientService: HttpClientService,
  ) {}

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
   * Return the SP endpoint URL for the root block. This is the storage provider's content gateway
   * (not an IPNI index URL). The service may use it as the base for block fetches.
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

    const spEndpoint = providerInfo.products.PDP.data.serviceURL.replace(/\/$/, "");
    const url = `${spEndpoint}/ipfs/${rootCID}`;

    this.logger.debug(`Constructed SP endpoint URL (root): ${url}`);

    return {
      url,
      method: this.name,
      headers: {},
      httpVersion: "2",
    };
  }

  /**
   * Validate by fetching each expected block from the SP endpoint (content gateway), not from IPNI.
   * GET /ipfs/<cid> with Accept: application/vnd.ipld.raw. No CAR — we only verify the root and
   * all child block CIDs (from deal metadata) are served and valid.
   */
  async validateByBlockFetch(config: RetrievalConfiguration, signal?: AbortSignal): Promise<ValidationResult> {
    const dealMetadata = config.deal.metadata?.[this.name];
    const rootCIDStr = dealMetadata?.rootCID;
    const blockCIDsStr = dealMetadata?.blockCIDs ?? [];

    if (!rootCIDStr) {
      this.logger.warn(`IPNI block-fetch validation failed for deal ${config.deal.id}: rootCID metadata is missing.`);
      return {
        isValid: false,
        method: this.validationMethods.metadataMissing,
        details: "Cannot validate: rootCID metadata is missing",
      };
    }

    const providerInfo = this.walletSdkService.getProviderInfo(config.storageProvider);
    if (!providerInfo?.products.PDP) {
      return {
        isValid: false,
        method: this.validationMethods.blockFetch,
        details: `Provider ${config.storageProvider} not found or has no PDP`,
      };
    }

    const spEndpoint = providerInfo.products.PDP.data.serviceURL.replace(/\/$/, "");
    const uniqueCids = Array.from(new Set([rootCIDStr, ...blockCIDsStr]));
    const errors: string[] = [];
    let verified = 0;

    for (const cidStr of uniqueCids) {
      signal?.throwIfAborted();
      const url = `${spEndpoint}/ipfs/${cidStr}`;
      try {
        const result = await this.httpClientService.requestWithoutProxyAndMetrics<Buffer>(url, {
          headers: { Accept: "application/vnd.ipld.raw" },
          httpVersion: "2",
          signal,
        });

        if (result.metrics.statusCode < 200 || result.metrics.statusCode >= 300) {
          errors.push(`cid ${cidStr}: HTTP ${result.metrics.statusCode}`);
          continue;
        }

        const cid = CID.parse(cidStr);
        await validateBlock({ cid, bytes: new Uint8Array(result.data) });
        verified += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`cid ${cidStr}: ${msg}`);
      }
    }

    const isValid = errors.length === 0;
    const details = isValid
      ? `Block-fetch validation: verified ${verified} blocks (root + DAG) from SP`
      : `Block-fetch validation failed: ${errors.join("; ")}`;

    if (!isValid) {
      this.logger.warn(`IPNI block-fetch validation failed for deal ${config.deal.id}: ${details}`);
    }

    return {
      isValid,
      method: this.validationMethods.blockFetch,
      details,
      comparison: {
        expected: uniqueCids.length,
        actual: verified,
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
