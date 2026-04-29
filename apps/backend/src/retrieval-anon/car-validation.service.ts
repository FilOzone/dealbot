import { CarReader } from "@ipld/car";
import * as dagPB from "@ipld/dag-pb";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { create as createBlock } from "multiformats/block";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 } from "multiformats/hashes/sha2";
import { toStructuredError } from "../common/logging.js";
import type { IConfig } from "../config/app.config.js";
import type { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { HttpClientService } from "../http-client/http-client.service.js";
import { IpniVerificationService } from "../ipni/ipni-verification.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import type { CarValidationResult } from "./types.js";

// UnixFS DAGs use only dag-pb (interior nodes) and raw (leaf data) codecs
const unixfsCodecs: Record<number, { code: number; decode: (bytes: Uint8Array) => unknown }> = {
  [dagPB.code]: dagPB,
  [raw.code]: raw,
};

@Injectable()
export class CarValidationService {
  private readonly logger = new Logger(CarValidationService.name);

  constructor(
    private readonly configService: ConfigService<IConfig, true>,
    private readonly httpClientService: HttpClientService,
    private readonly walletSdkService: WalletSdkService,
    private readonly ipniVerificationService: IpniVerificationService,
  ) {}

  /**
   * Validate an anonymous piece retrieved as a CAR:
   * 1. parse the CAR,
   * 2. sample random blocks,
   * 3. confirm the SP is advertised for the root + sampled CIDs via IPNI,
   * 4. fetch each sampled block from the SP and hash-verify it.
   *
   * CAR parse failure is attributed to the client (bad upload), not the SP.
   */
  async validateCarPiece(
    pieceBytes: Buffer,
    provider: StorageProvider,
    ipfsRootCid: string,
    signal?: AbortSignal,
  ): Promise<CarValidationResult> {
    let blocks: { cid: CID; bytes: Uint8Array }[];
    try {
      blocks = await this.parseCar(pieceBytes);
    } catch (error) {
      this.logger.debug({
        event: "car_parse_failed",
        message: "Failed to parse piece bytes as CAR - client fault, not SP",
        spAddress: provider.address,
        ipfsRootCid,
        error: toStructuredError(error),
      });
      return {
        carParseable: false,
        blockCount: 0,
        sampledCidCount: 0,
        ipniValid: null,
        ipniVerifyMs: null,
        ipniVerifiedCidsCount: null,
        ipniUnverifiedCidsCount: null,
        blockFetchValid: null,
        blockFetchFailedCount: null,
        blockFetchEndpoint: null,
      };
    }
    if (blocks.length === 0) {
      return {
        carParseable: true,
        blockCount: 0,
        sampledCidCount: 0,
        ipniValid: null,
        ipniVerifyMs: null,
        ipniVerifiedCidsCount: null,
        ipniUnverifiedCidsCount: null,
        blockFetchValid: null,
        blockFetchFailedCount: null,
        blockFetchEndpoint: null,
        errorMessage: "CAR contained no blocks",
      };
    }

    const sampleCount = this.configService.get("retrieval", { infer: true }).anonBlockSampleCount;
    const shuffled = [...blocks].sort(() => Math.random() - 0.5);
    const sampledBlocks = shuffled.slice(0, sampleCount);

    const ipni = await this.checkIpni(provider, ipfsRootCid, sampledBlocks, signal);
    const blockFetchResult = await this.checkBlockFetch(sampledBlocks, provider.address, signal);

    return {
      carParseable: true,
      blockCount: blocks.length,
      sampledCidCount: sampledBlocks.length,
      ipniValid: ipni.valid,
      ipniVerifyMs: ipni.durationMs,
      ipniVerifiedCidsCount: ipni.verifiedCount,
      ipniUnverifiedCidsCount: ipni.unverifiedCount,
      blockFetchValid: blockFetchResult.valid,
      blockFetchFailedCount: blockFetchResult.failedCount,
      blockFetchEndpoint: blockFetchResult.endpoint,
      errorMessage: blockFetchResult.errorMessage,
    };
  }

  private async parseCar(pieceBytes: Buffer): Promise<{ cid: CID; bytes: Uint8Array }[]> {
    const reader = await CarReader.fromBytes(new Uint8Array(pieceBytes));
    const blocks: { cid: CID; bytes: Uint8Array }[] = [];
    for await (const block of reader.blocks()) {
      blocks.push({ cid: block.cid, bytes: block.bytes });
    }
    return blocks;
  }

  /**
   * Verify via IPNI that the SP is advertised for the root CID and each sampled child CID.
   * Delegates to the shared IpniVerificationService which uses filecoin-pin's provider-scoped check.
   */
  private async checkIpni(
    provider: StorageProvider,
    ipfsRootCid: string,
    sampledBlocks: ReadonlyArray<{ cid: CID }>,
    signal?: AbortSignal,
  ): Promise<{
    valid: boolean;
    durationMs: number | null;
    verifiedCount: number | null;
    unverifiedCount: number | null;
  }> {
    const timeouts = this.configService.get("timeouts", { infer: true });
    let rootCid: CID;
    try {
      rootCid = CID.parse(ipfsRootCid);
    } catch (error) {
      this.logger.warn({
        event: "ipni_root_cid_invalid",
        message: "Failed to parse ipfsRootCID",
        ipfsRootCid,
        providerAddress: provider.address,
        error: toStructuredError(error),
      });
      return { valid: false, durationMs: null, verifiedCount: null, unverifiedCount: null };
    }

    const result = await this.ipniVerificationService.verify({
      rootCid,
      blockCids: sampledBlocks.map((b) => b.cid),
      storageProvider: provider,
      timeoutMs: timeouts.ipniVerificationTimeoutMs,
      pollIntervalMs: timeouts.ipniVerificationPollingMs,
      signal,
    });

    return {
      valid: result.rootCIDVerified,
      durationMs: result.durationMs,
      verifiedCount: result.verified,
      unverifiedCount: result.unverified,
    };
  }

  /**
   * Fetch each sampled block from the SP endpoint and hash-verify the response
   * against the declared CID. Mirrors IpfsBlockRetrievalStrategy's per-block
   * verification for the sampled subset (no DAG traversal).
   */
  private async checkBlockFetch(
    sampledBlocks: ReadonlyArray<{ cid: CID; bytes: Uint8Array }>,
    spAddress: string,
    signal?: AbortSignal,
  ): Promise<{ valid: boolean | null; failedCount: number | null; endpoint: string | null; errorMessage?: string }> {
    const providerInfo = this.walletSdkService.getProviderInfo(spAddress);
    if (!providerInfo) {
      return {
        valid: null,
        failedCount: null,
        endpoint: null,
        errorMessage: `Provider info not found for ${spAddress}`,
      };
    }

    const spBaseUrl = providerInfo.pdp.serviceURL.replace(/\/$/, "");
    const endpoint = `${spBaseUrl}/ipfs/`;
    let failedCount = 0;

    for (const block of sampledBlocks) {
      const cidStr = block.cid.toString();
      const blockUrl = `${spBaseUrl}/ipfs/${cidStr}?format=raw`;

      try {
        const resp = await this.httpClientService.requestWithMetrics<Buffer>(blockUrl, {
          headers: { Accept: "application/vnd.ipld.raw" },
          httpVersion: "2",
          signal,
        });

        if (resp.metrics.statusCode < 200 || resp.metrics.statusCode >= 300) {
          failedCount += 1;
          this.logger.warn({
            event: "block_fetch_non_2xx",
            message: "Block fetch returned non-2xx status",
            cid: cidStr,
            spAddress,
            statusCode: resp.metrics.statusCode,
          });
          continue;
        }

        if (block.cid.multihash.code !== sha256.code) {
          this.logger.warn({
            event: "block_unsupported_hash",
            message: `Unsupported hash algorithm 0x${block.cid.multihash.code.toString(16)}`,
            cid: cidStr,
            spAddress,
          });
          failedCount += 1;
          continue;
        }

        const codec = unixfsCodecs[block.cid.code];
        if (!codec) {
          this.logger.warn({
            event: "block_unsupported_codec",
            message: `Unsupported codec 0x${block.cid.code.toString(16)}`,
            cid: cidStr,
            spAddress,
          });
          failedCount += 1;
          continue;
        }

        // Hash-verifies and decodes; throws on mismatch
        await createBlock({ bytes: resp.data, cid: block.cid, hasher: sha256, codec });
      } catch (error) {
        failedCount += 1;
        this.logger.warn({
          event: "block_fetch_failed",
          message: "Block fetch or hash verification failed",
          cid: cidStr,
          spAddress,
          error: toStructuredError(error),
        });
      }
    }

    return { valid: failedCount === 0, failedCount, endpoint };
  }
}
