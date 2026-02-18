import * as dagPB from "@ipld/dag-pb";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { validateBlock } from "@web3-storage/car-block-validator";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import type { IConfig } from "../../config/app.config.js";
import { ServiceType } from "../../database/types.js";
import { HttpClientService } from "../../http-client/http-client.service.js";
import { WalletSdkService } from "../../wallet-sdk/wallet-sdk.service.js";
import type { IRetrievalAddon } from "../interfaces/retrieval-addon.interface.js";
import type { ExpectedMetrics, RetrievalConfiguration, RetrievalUrlResult, ValidationResult } from "../types.js";
import { RetrievalPriority } from "../types.js";

/**
 * IPFS-block retrieval strategy.
 *
 * Terminology:
 * - **IPNI** = the index that lists the SP as a provider for content (we do not call an "IPNI URL" here).
 * - **SP endpoint** = the storage provider's content gateway; we call this to fetch blocks (GET /ipfs/<cid>).
 *
 * This strategy validates that the SP serves the root CID and all DAG blocks by traversing links from
 * the root and fetching each block from the **SP endpoint** with Accept: application/vnd.ipld.raw.
 * No CAR involved.
 */
@Injectable()
export class IpfsBlockRetrievalStrategy implements IRetrievalAddon {
  private readonly logger = new Logger(IpfsBlockRetrievalStrategy.name);
  private readonly blockFetchConcurrency: number;
  private readonly validationMethods = {
    metadataMissing: "metadata-missing",
    blockFetch: "block-fetch",
  } as const;

  readonly name = ServiceType.IPFS_PIN;
  readonly priority = RetrievalPriority.MEDIUM; // Alternative method

  constructor(
    private readonly walletSdkService: WalletSdkService,
    private readonly httpClientService: HttpClientService,
    private readonly configService: ConfigService<IConfig, true>,
  ) {
    const retrievalConfig = this.configService.get("retrieval");
    this.blockFetchConcurrency = Math.max(1, retrievalConfig?.ipfsBlockFetchConcurrency ?? 6);
  }

  /**
   * IPNI retrieval is only available if IPNI was enabled during deal creation
   */
  canHandle(config: RetrievalConfiguration): boolean {
    // Check if IPNI was enabled in deal metadata
    const ipniEnabled = config.deal.metadata?.[this.name]?.enabled === true;

    if (!ipniEnabled) {
      this.logger.debug(
        `IPFS block retrieval not available for deal ${config.deal.id}: IPNI not enabled during creation`,
      );
      return false;
    }

    // Verify we have the root CID
    const rootCID = config.deal.metadata?.[this.name]?.rootCID;
    if (!rootCID) {
      this.logger.warn(`IPFS block retrieval not available for deal ${config.deal.id}: missing root CID`);
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
   * Validate by traversing the DAG from the root CID and fetching each block from the SP endpoint.
   * We use GET /ipfs/<cid> with Accept: application/vnd.ipld.raw, verify the CID multihash, then
   * decode dag-pb links (raw blocks have no links).
   */
  async validateByBlockFetch(config: RetrievalConfiguration, signal?: AbortSignal): Promise<ValidationResult> {
    const dealMetadata = config.deal.metadata?.[this.name];
    const rootCIDStr = dealMetadata?.rootCID;

    if (!rootCIDStr) {
      this.logger.warn(`IPFS block-fetch validation failed for deal ${config.deal.id}: rootCID metadata is missing.`);
      return {
        isValid: false,
        method: this.validationMethods.metadataMissing,
        details: "Cannot validate: rootCID metadata is missing",
      };
    }

    let spEndpoint: string;
    try {
      const rootUrl = this.constructUrl(config).url;
      spEndpoint = rootUrl.replace(/\/ipfs\/[^/]+$/, "");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        isValid: false,
        method: this.validationMethods.blockFetch,
        details: errorMessage,
      };
    }
    let failed = 0;
    const queue: string[] = [];
    const enqueued = new Set<string>();
    const seen = new Set<string>();
    let verified = 0;
    let totalBytes = 0;

    const enqueue = (cidStr: string) => {
      if (enqueued.has(cidStr)) return;
      enqueued.add(cidStr);
      queue.push(cidStr);
    };

    enqueue(rootCIDStr);

    const processCid = async (cidStr: string) => {
      if (seen.has(cidStr)) return;
      seen.add(cidStr);
      signal?.throwIfAborted();

      const url = `${spEndpoint}/ipfs/${cidStr}`;
      const result = await this.httpClientService.requestWithoutProxyAndMetrics<Buffer>(url, {
        headers: { Accept: "application/vnd.ipld.raw" },
        httpVersion: "2",
        signal,
      });

      if (result.metrics.statusCode < 200 || result.metrics.statusCode >= 300) {
        throw new Error(`HTTP ${result.metrics.statusCode}`);
      }

      const cid = CID.parse(cidStr);
      const bytes = new Uint8Array(result.data);
      await validateBlock({ cid, bytes });
      verified += 1;
      totalBytes += result.data.length;

      const links = this.extractDagLinks(cid, bytes);
      for (const link of links) {
        enqueue(link);
      }
    };

    while (queue.length > 0) {
      signal?.throwIfAborted();
      const batch = queue.splice(0, this.blockFetchConcurrency);
      await Promise.all(
        batch.map(async (cidStr) => {
          try {
            await processCid(cidStr);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            failed += 1;
            this.logger.warn(`IPFS block-fetch validation error for deal ${config.deal.id}: cid ${cidStr} - ${msg}`);
          }
        }),
      );
    }

    const isValid = failed === 0;
    const total = verified + failed;
    const details = isValid
      ? `Block-fetch validation: verified ${verified} blocks via DAG traversal`
      : `Block-fetch validation failed: ${failed}/${total} blocks failed for rootCID ${rootCIDStr}. ` +
        `See logs for detailed block errors.`;

    if (!isValid) {
      this.logger.warn(`IPFS block-fetch validation failed for deal ${config.deal.id}: ${details}`);
    }

    return {
      isValid,
      method: this.validationMethods.blockFetch,
      details,
      bytesRead: totalBytes,
    };
  }

  private extractDagLinks(cid: CID, bytes: Uint8Array): string[] {
    if (cid.code === raw.code) {
      return [];
    }

    if (cid.code !== dagPB.code) {
      throw new Error(`unsupported codec ${cid.code}`);
    }

    const node = dagPB.decode(bytes);
    const links: string[] = [];
    for (const link of node.Links ?? []) {
      const linkCid = CID.asCID(link.Hash);
      if (linkCid) {
        links.push(linkCid.toString());
      }
    }
    return links;
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
