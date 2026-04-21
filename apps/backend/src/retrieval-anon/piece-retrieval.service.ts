import { asPieceCID, calculate as calculatePieceCid } from "@filoz/synapse-core/piece";
import { Injectable, Logger } from "@nestjs/common";
import { toStructuredError } from "../common/logging.js";
import { HttpClientService } from "../http-client/http-client.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import type { PieceRetrievalResult } from "./types.js";

@Injectable()
export class PieceRetrievalService {
  private readonly logger = new Logger(PieceRetrievalService.name);

  constructor(
    private readonly walletSdkService: WalletSdkService,
    private readonly httpClientService: HttpClientService,
  ) {}

  async fetchPiece(spAddress: string, pieceCid: string, signal?: AbortSignal): Promise<PieceRetrievalResult> {
    const providerInfo = this.walletSdkService.getProviderInfo(spAddress);

    if (!providerInfo) {
      this.logger.warn({
        event: "provider_info_not_found",
        message: "Cannot fetch piece: provider info not found",
        spAddress,
        pieceCid,
      });

      return {
        success: false,
        pieceCid,
        bytesReceived: 0,
        pieceBytes: null,
        latencyMs: 0,
        ttfbMs: 0,
        throughputBps: 0,
        statusCode: 0,
        commPValid: false,
        errorMessage: `Provider info not found for ${spAddress}`,
      };
    }

    const baseUrl = providerInfo.pdp.serviceURL.replace(/\/$/, "");
    const url = `${baseUrl}/piece/${pieceCid}`;

    try {
      const result = await this.httpClientService.requestWithMetrics<Buffer>(url, {
        httpVersion: "2",
        signal,
      });

      const { metrics } = result;
      const isSuccess = metrics.statusCode >= 200 && metrics.statusCode < 300;

      if (!isSuccess) {
        this.logger.warn({
          event: "piece_fetch_non_2xx",
          message: "Piece fetch returned non-2xx status",
          url,
          statusCode: metrics.statusCode,
          pieceCid,
          spAddress,
        });

        return {
          success: false,
          pieceCid,
          bytesReceived: metrics.responseSize,
          pieceBytes: null,
          latencyMs: metrics.totalTime,
          ttfbMs: metrics.ttfb,
          throughputBps: metrics.totalTime > 0 ? metrics.responseSize / (metrics.totalTime / 1000) : 0,
          statusCode: metrics.statusCode,
          commPValid: false,
          errorMessage: `HTTP ${metrics.statusCode}`,
        };
      }

      const pieceBytes = Buffer.isBuffer(result.data) ? result.data : Buffer.from(result.data);
      const commPValid = await this.validateCommP(pieceBytes, pieceCid);
      const throughputBps = metrics.totalTime > 0 ? metrics.responseSize / (metrics.totalTime / 1000) : 0;

      this.logger.debug({
        event: "piece_fetch_success",
        message: "Piece fetched successfully",
        pieceCid,
        spAddress,
        bytesReceived: metrics.responseSize,
        latencyMs: metrics.totalTime,
        ttfbMs: metrics.ttfb,
      });

      return {
        success: true,
        pieceCid,
        bytesReceived: metrics.responseSize,
        pieceBytes,
        latencyMs: metrics.totalTime,
        ttfbMs: metrics.ttfb,
        throughputBps,
        statusCode: metrics.statusCode,
        commPValid,
      };
    } catch (error) {
      this.logger.warn({
        event: "piece_fetch_failed",
        message: "Piece fetch threw an error",
        url,
        pieceCid,
        spAddress,
        error: toStructuredError(error),
      });

      return {
        success: false,
        pieceCid,
        bytesReceived: 0,
        pieceBytes: null,
        latencyMs: 0,
        ttfbMs: 0,
        throughputBps: 0,
        statusCode: 0,
        commPValid: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Compute the piece CID (sha2-256-trunc254-padded) of the retrieved bytes and compare
   * against the expected CID. Returns false on parse failure, computation failure, or mismatch.
   */
  private async validateCommP(bytes: Buffer, pieceCid: string): Promise<boolean> {
    const expected = asPieceCID(pieceCid);
    if (!expected) {
      this.logger.warn({
        event: "commp_invalid_piece_cid",
        message: "Cannot parse expected piece CID for CommP validation",
        pieceCid,
      });
      return false;
    }

    try {
      const computed = calculatePieceCid(bytes);
      const matches = computed.toString() === expected.toString();
      if (!matches) {
        this.logger.warn({
          event: "commp_mismatch",
          message: "Piece CID mismatch: SP-returned bytes hash to a different CID",
          expected: expected.toString(),
          computed: computed.toString(),
        });
      }
      return matches;
    } catch (error) {
      this.logger.warn({
        event: "commp_validation_error",
        message: "CommP computation threw an error",
        pieceCid,
        error: toStructuredError(error),
      });
      return false;
    }
  }
}
