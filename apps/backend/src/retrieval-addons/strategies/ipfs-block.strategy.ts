import * as dagPB from "@ipld/dag-pb";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { create as createBlock } from "multiformats/block";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 } from "multiformats/hashes/sha2";
import type { IConfig } from "../../config/app.config.js";
import { ServiceType } from "../../database/types.js";
import { HttpClientService } from "../../http-client/http-client.service.js";
import { WalletSdkService } from "../../wallet-sdk/wallet-sdk.service.js";
import type { IRetrievalAddon } from "../interfaces/retrieval-addon.interface.js";
import type { ExpectedMetrics, RetrievalConfiguration, RetrievalUrlResult, ValidationResult } from "../types.js";
import { RetrievalPriority } from "../types.js";

// UnixFS DAGs use only dag-pb (interior nodes) and raw (leaf data) codecs
const unixfsCodecs: Record<number, { code: number; decode: (bytes: Uint8Array) => unknown }> = {
  [dagPB.code]: dagPB,
  [raw.code]: raw,
};

/**
 * IPFS-block retrieval strategy.
 *
 * Terminology:
 * - **IPNI** = the index that lists the SP as a provider for content (we do not call an "IPNI URL" here).
 * - **SP endpoint** = the storage provider's content gateway; we call this to fetch blocks (GET /ipfs/<cid>).
 *
 * This strategy validates that the SP serves the root CID and all DAG blocks by traversing links from
 * the root and fetching each block from the **SP endpoint** with Accept: application/vnd.ipld.raw.
 * Expects UnixFS data — blocks must be dag-pb or raw codec with sha2-256 hashing. No CAR involved.
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

  private getSpEndpoint(config: RetrievalConfiguration): string {
    const providerInfo = this.walletSdkService.getProviderInfo(config.storageProvider);

    if (!providerInfo) {
      throw new Error(`Provider ${config.storageProvider} not found in approved providers`);
    }

    if (!providerInfo.products.PDP) {
      throw new Error(`Provider ${config.storageProvider} does not support PDP`);
    }

    return providerInfo.products.PDP.data.serviceURL.replace(/\/$/, "");
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

    const spEndpoint = this.getSpEndpoint(config);
    const url = `${spEndpoint}/ipfs/${rootCID}?format=raw`;

    this.logger.debug(`Constructed SP endpoint URL (root): ${url}`);

    return {
      url,
      method: this.name,
      headers: {},
      httpVersion: "2",
    };
  }

  /**
   * Validate by traversing the UnixFS DAG from the root CID and fetching each block from the SP
   * endpoint. Blocks are requested via GET /ipfs/<cid>?format=raw with Accept:
   * application/vnd.ipld.raw, hash-verified against the CID, and decoded to discover links.
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
      spEndpoint = this.getSpEndpoint(config);
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
    const seen = new Set<string>();
    let verified = 0;
    let totalBytes = 0;
    let firstBlockTtfb: number | undefined;

    const enqueue = (cidStr: string) => {
      if (seen.has(cidStr)) return;
      seen.add(cidStr);
      queue.push(cidStr);
    };

    enqueue(rootCIDStr);

    const processCid = async (cidStr: string) => {
      signal?.throwIfAborted();

      const url = `${spEndpoint}/ipfs/${cidStr}?format=raw`;
      const result = await this.httpClientService.requestWithoutProxyAndMetrics<Buffer>(url, {
        headers: { Accept: "application/vnd.ipld.raw" },
        httpVersion: "2",
        signal,
      });

      if (result.metrics.statusCode < 200 || result.metrics.statusCode >= 300) {
        throw new Error(`HTTP ${result.metrics.statusCode}`);
      }

      if (firstBlockTtfb === undefined) {
        firstBlockTtfb = result.metrics.ttfb;
      }

      const cid = CID.parse(cidStr);
      const bytes = result.data;

      if (cid.multihash.code !== sha256.code) {
        throw new Error(`Unsupported hash algorithm 0x${cid.multihash.code.toString(16)} for ${cidStr}`);
      }

      const codec = unixfsCodecs[cid.code];
      if (!codec) {
        throw new Error(`Unsupported codec 0x${cid.code.toString(16)} for ${cidStr}, expected dag-pb or raw`);
      }

      // Hash-verifies and decodes; throws on mismatch
      const block = await createBlock({ bytes, cid, hasher: sha256, codec });
      verified += 1;
      totalBytes += bytes.length;

      for (const [, linkCid] of block.links()) {
        enqueue(linkCid.toString());
      }
    };

    // Concurrency pool: keep all slots busy rather than waiting for wave completion
    const active = new Set<Promise<void>>();
    while (queue.length > 0 || active.size > 0) {
      signal?.throwIfAborted();
      while (active.size < this.blockFetchConcurrency && queue.length > 0) {
        const cidStr = queue.shift()!;
        const p = processCid(cidStr)
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            failed += 1;
            this.logger.warn(`IPFS block-fetch validation error for deal ${config.deal.id}: cid ${cidStr} - ${msg}`);
          })
          .finally(() => active.delete(p));
        active.add(p);
      }
      if (active.size > 0) {
        await Promise.race(active);
      }
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
      ttfb: firstBlockTtfb,
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
