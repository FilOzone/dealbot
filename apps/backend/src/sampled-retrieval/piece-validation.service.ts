import { CarReader } from "@ipld/car";
import * as dagPB from "@ipld/dag-pb";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { create as createBlock } from "multiformats/block";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 } from "multiformats/hashes/sha2";
import { toStructuredError } from "../common/logging.js";
import type { Network } from "../common/types.js";
import type { IConfig } from "../config/index.js";
import type { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { BlockFetchStatus, CarParseStatus, IpniCheckStatus } from "../database/types.js";
import { HttpClientService } from "../http-client/http-client.service.js";
import { IpniVerificationService } from "../ipni/ipni-verification.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { SAMPLED_MAX_BLOCK_DOWNLOAD_BYTES } from "./sampled-piece-selector.service.js";
import type { BlockFetchOutcome, CarParseOutcome, IpniCheckOutcome, SampledBlock } from "./types.js";

// UnixFS DAGs use only dag-pb (interior nodes) and raw (leaf data) codecs
const unixfsCodecs: Record<number, { code: number; decode: (bytes: Uint8Array) => unknown }> = {
  [dagPB.code]: dagPB,
  [raw.code]: raw,
};

/**
 * Per-dimension validators for anonymous-retrieval pieces that advertise
 * IPFS indexing. Each method is independent: a failure in one cannot bleed
 * into another's status. Service methods only throw on abort; every other
 * failure mode is encoded in the returned outcome's `status`.
 */
@Injectable()
export class PieceValidationService {
  private readonly logger = new Logger(PieceValidationService.name);

  constructor(
    private readonly configService: ConfigService<IConfig, true>,
    private readonly httpClientService: HttpClientService,
    private readonly walletSdkService: WalletSdkService,
    private readonly ipniVerificationService: IpniVerificationService,
  ) {}

  /**
   * Parse the fetched piece bytes as a CAR and pre-sample a random subset
   * for downstream IPNI + block-fetch checks. CAR parse failure is
   * attributed to the client (bad upload), not the SP.
   *
   * Returns `failure.not_parseable` on parser exceptions. Propagates abort.
   */
  async parseCar(pieceBytes: Buffer, signal?: AbortSignal): Promise<CarParseOutcome> {
    let blocks: SampledBlock[];
    try {
      blocks = await this.readBlocks(pieceBytes, signal);
    } catch (error) {
      signal?.throwIfAborted();
      this.logger.debug({
        event: "car_parse_failed",
        message: "Failed to parse piece bytes as CAR - client fault, not SP",
        error: toStructuredError(error),
      });
      return { status: CarParseStatus.FAILURE_NOT_PARSEABLE };
    }

    if (blocks.length === 0) {
      return {
        status: CarParseStatus.SUCCESS,
        blockCount: 0,
        sampledBlocks: [],
      };
    }

    const sampleCount = this.configService.get("retrieval", { infer: true }).sampledBlockSampleCount;
    const sampledBlocks = this.sampleBlocks(blocks, sampleCount);

    return {
      status: CarParseStatus.SUCCESS,
      blockCount: blocks.length,
      sampledBlocks,
    };
  }

  /**
   * Uniformly select up to `count` blocks without replacement via a partial
   * Fisher-Yates shuffle (O(count)).
   */
  private sampleBlocks(blocks: ReadonlyArray<SampledBlock>, count: number): SampledBlock[] {
    const pool = [...blocks];
    const k = Math.min(count, pool.length);
    for (let i = 0; i < k; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, k);
  }

  /**
   * Verify via IPNI that the SP is advertised for the root CID and each
   * sampled child CID. SKIPPED when the root CID can't be parsed (a client
   * upload artifact, not something to attempt against the SP). ERROR is
   * reserved for unexpected exceptions from the verifier.
   */
  async checkIpni(
    provider: StorageProvider,
    ipfsRootCid: string,
    sampledBlocks: ReadonlyArray<SampledBlock>,
    signal?: AbortSignal,
  ): Promise<IpniCheckOutcome> {
    let rootCid: CID;
    try {
      rootCid = CID.parse(ipfsRootCid);
    } catch (error) {
      this.logger.warn({
        event: "ipni_root_cid_invalid",
        message: "Failed to parse ipfsRootCID — skipping IPNI verification",
        ipfsRootCid,
        providerAddress: provider.address,
        error: toStructuredError(error),
      });
      return { status: IpniCheckStatus.SKIPPED, durationMs: null };
    }

    const timeouts = this.configService.get("timeouts", { infer: true });

    try {
      const result = await this.ipniVerificationService.verify({
        rootCid,
        blockCids: sampledBlocks.map((b) => b.cid),
        storageProvider: provider,
        timeoutMs: timeouts.ipniVerificationTimeoutMs,
        pollIntervalMs: timeouts.ipniVerificationPollingMs,
        signal,
      });
      return {
        status: result.rootCIDVerified ? IpniCheckStatus.SUCCESS : IpniCheckStatus.FAILURE_TIMEDOUT,
        durationMs: result.durationMs,
      };
    } catch (error) {
      signal?.throwIfAborted();
      this.logger.warn({
        event: "ipni_verification_failed",
        message: "IPNI verification threw unexpectedly",
        providerAddress: provider.address,
        ipfsRootCid,
        error: toStructuredError(error),
      });
      return { status: IpniCheckStatus.FAILURE_OTHER, durationMs: null };
    }
  }

  /**
   * Fetch each sampled block from the SP endpoint and hash-verify the
   * response against the declared CID. SKIPPED when SP info is missing
   * (not the SP's fault — we couldn't even find the gateway). Both per-block
   * verification failures (aggregated into `failedCount`) and unexpected
   * exceptions outside the per-block loop map to FAILURE_OTHER.
   */
  async checkBlockFetch(
    sampledBlocks: ReadonlyArray<SampledBlock>,
    spAddress: string,
    network: Network,
    signal?: AbortSignal,
  ): Promise<BlockFetchOutcome> {
    const providerInfo = this.walletSdkService.getProviderInfo(spAddress, network);
    if (!providerInfo) {
      return {
        status: BlockFetchStatus.SKIPPED,
        sampledCount: sampledBlocks.length,
        failedCount: null,
        endpoint: null,
        errorMessage: `Provider info not found for ${spAddress}`,
      };
    }

    const spBaseUrl = providerInfo.pdp.serviceURL.replace(/\/$/, "");
    const endpoint = `${spBaseUrl}/ipfs/`;

    try {
      let failedCount = 0;
      for (const block of sampledBlocks) {
        if (!(await this.fetchAndVerifyBlock(block, spBaseUrl, spAddress, signal))) {
          failedCount += 1;
        }
      }
      return {
        status: failedCount === 0 ? BlockFetchStatus.SUCCESS : BlockFetchStatus.FAILURE_OTHER,
        sampledCount: sampledBlocks.length,
        failedCount,
        endpoint,
      };
    } catch (error) {
      signal?.throwIfAborted();
      this.logger.warn({
        event: "block_fetch_unexpected_error",
        message: "Block fetch loop threw unexpectedly",
        spAddress,
        network,
        error: toStructuredError(error),
      });
      return {
        status: BlockFetchStatus.FAILURE_OTHER,
        sampledCount: sampledBlocks.length,
        failedCount: null,
        endpoint,
        errorMessage: error instanceof Error ? error.message : "Unknown block-fetch error",
      };
    }
  }

  private async readBlocks(pieceBytes: Buffer, signal?: AbortSignal): Promise<SampledBlock[]> {
    const reader = await CarReader.fromBytes(new Uint8Array(pieceBytes));
    const blocks: SampledBlock[] = [];
    for await (const block of reader.blocks()) {
      signal?.throwIfAborted();
      blocks.push({ cid: block.cid, bytes: block.bytes });
    }
    return blocks;
  }

  /**
   * Fetch one sampled block and hash-verify it. Returns true on success.
   * Per-block failures are logged at warn; they never throw out of the
   * caller's loop, so transient block errors stay attributable to that
   * single block rather than terminating the whole check.
   */
  private async fetchAndVerifyBlock(
    block: SampledBlock,
    spBaseUrl: string,
    spAddress: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const cidStr = block.cid.toString();
    const blockUrl = `${spBaseUrl}/ipfs/${cidStr}?format=raw`;

    try {
      const resp = await this.httpClientService.requestWithMetrics<Buffer>(blockUrl, {
        headers: { Accept: "application/vnd.ipld.raw" },
        httpVersion: "2",
        maxBytes: SAMPLED_MAX_BLOCK_DOWNLOAD_BYTES,
        signal,
      });

      if (resp.limitExceeded) {
        this.logger.warn({
          event: "block_fetch_too_large",
          message: "Block fetch exceeded max download size",
          cid: cidStr,
          spAddress,
          bytesReceived: resp.metrics.responseSize,
          maxBytes: SAMPLED_MAX_BLOCK_DOWNLOAD_BYTES,
        });
        return false;
      }

      if (resp.aborted) {
        this.logger.warn({
          event: "block_fetch_aborted",
          message: "Block fetch was aborted",
          cid: cidStr,
          spAddress,
          abortReason: resp.abortReason,
        });
        return false;
      }

      if (resp.metrics.statusCode < 200 || resp.metrics.statusCode >= 300) {
        this.logger.warn({
          event: "block_fetch_non_2xx",
          message: "Block fetch returned non-2xx status",
          cid: cidStr,
          spAddress,
          statusCode: resp.metrics.statusCode,
        });
        return false;
      }

      if (block.cid.multihash.code !== sha256.code) {
        this.logger.warn({
          event: "block_unsupported_hash",
          message: `Unsupported hash algorithm 0x${block.cid.multihash.code.toString(16)}`,
          cid: cidStr,
          spAddress,
        });
        return false;
      }

      const codec = unixfsCodecs[block.cid.code];
      if (!codec) {
        this.logger.warn({
          event: "block_unsupported_codec",
          message: `Unsupported codec 0x${block.cid.code.toString(16)}`,
          cid: cidStr,
          spAddress,
        });
        return false;
      }

      // Hash-verifies and decodes; throws on mismatch
      await createBlock({ bytes: resp.data, cid: block.cid, hasher: sha256, codec });
      return true;
    } catch (error) {
      this.logger.warn({
        event: "block_fetch_failed",
        message: "Block fetch or hash verification failed",
        cid: cidStr,
        spAddress,
        error: toStructuredError(error),
      });
      return false;
    }
  }
}
