import * as Piece from "@filoz/synapse-core/piece";
import { Injectable, Logger } from "@nestjs/common";
import { toStructuredError } from "../common/logging.js";
import type { Network } from "../common/types.js";
import { HttpClientService } from "../http-client/http-client.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { SAMPLED_MAX_PIECE_DOWNLOAD_BYTES } from "./sampled-piece-selector.service.js";
import type { PieceRetrievalResult } from "./types.js";

@Injectable()
export class PieceRetrievalService {
  private readonly logger = new Logger(PieceRetrievalService.name);

  constructor(
    private readonly walletSdkService: WalletSdkService,
    private readonly httpClientService: HttpClientService,
  ) {}

  async fetchPiece(
    spAddress: string,
    network: Network,
    pieceCid: string,
    signal?: AbortSignal,
  ): Promise<PieceRetrievalResult> {
    const providerInfo = this.walletSdkService.getProviderInfo(spAddress, network);

    if (!providerInfo) {
      this.logger.warn({
        event: "provider_info_not_found",
        message: "Cannot fetch piece: provider info not found",
        spAddress,
        network,
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
        httpSuccess: false,
        commPValid: false,
        errorMessage: `Provider info not found for ${spAddress}`,
      };
    }

    const baseUrl = providerInfo.pdp.serviceURL.replace(/\/$/, "");
    const url = `${baseUrl}/piece/${pieceCid}`;

    try {
      const result = await this.httpClientService.requestWithMetrics<Buffer>(url, {
        httpVersion: "2",
        maxBytes: SAMPLED_MAX_PIECE_DOWNLOAD_BYTES,
        signal,
      });

      const { metrics } = result;
      const isHttpSuccess = metrics.statusCode >= 200 && metrics.statusCode < 300;
      const throughputBps = metrics.totalTime > 0 ? metrics.responseSize / (metrics.totalTime / 1000) : 0;

      if (result.limitExceeded) {
        this.logger.warn({
          event: "piece_fetch_too_large",
          message: "Piece fetch exceeded max download size; aborted to protect worker memory",
          url,
          pieceCid,
          spAddress,
          bytesReceived: metrics.responseSize,
          maxBytes: SAMPLED_MAX_PIECE_DOWNLOAD_BYTES,
        });

        return {
          success: false,
          pieceCid,
          bytesReceived: metrics.responseSize,
          pieceBytes: null,
          latencyMs: metrics.totalTime,
          ttfbMs: metrics.ttfb,
          throughputBps,
          statusCode: metrics.statusCode,
          httpSuccess: false,
          commPValid: false,
          errorMessage: `Piece exceeded max download size of ${SAMPLED_MAX_PIECE_DOWNLOAD_BYTES} bytes`,
          tooLarge: true,
        };
      }

      if (result.aborted) {
        this.logger.warn({
          event: "piece_fetch_aborted",
          message: "Piece fetch aborted mid-download; returning partial metrics",
          url,
          pieceCid,
          spAddress,
          network,
          bytesReceived: metrics.responseSize,
          ttfbMs: metrics.ttfb,
          abortReason: result.abortReason,
        });

        return {
          success: false,
          pieceCid,
          bytesReceived: metrics.responseSize,
          pieceBytes: null,
          latencyMs: metrics.totalTime,
          ttfbMs: metrics.ttfb,
          throughputBps,
          statusCode: metrics.statusCode,
          httpSuccess: false,
          commPValid: false,
          errorMessage: result.abortReason ?? "aborted",
          aborted: true,
        };
      }

      if (!isHttpSuccess) {
        this.logger.warn({
          event: "piece_fetch_non_2xx",
          message: "Piece fetch returned non-2xx status",
          url,
          statusCode: metrics.statusCode,
          pieceCid,
          spAddress,
          network,
        });

        return {
          success: false,
          pieceCid,
          bytesReceived: metrics.responseSize,
          pieceBytes: null,
          latencyMs: metrics.totalTime,
          ttfbMs: metrics.ttfb,
          throughputBps,
          statusCode: metrics.statusCode,
          httpSuccess: false,
          commPValid: false,
          errorMessage: `HTTP ${metrics.statusCode}`,
        };
      }

      const pieceBytes = Buffer.isBuffer(result.data) ? result.data : Buffer.from(result.data);
      const commPValid = await this.validateCommP(pieceBytes, pieceCid);

      if (!commPValid) {
        // A 2xx response with bytes that don't hash to the requested piece CID
        // is a retrieval failure, not a success — downstream consumers must not
        // treat it as a successfully-served piece. Don't propagate the wrong
        // bytes either, so a misbehaving SP can't drag CAR parsing into the
        // failure mode.
        this.logger.warn({
          event: "piece_fetch_commp_mismatch",
          message: "Piece fetched but bytes do not match requested piece CID",
          url,
          pieceCid,
          spAddress,
          network,
          bytesReceived: metrics.responseSize,
        });

        return {
          success: false,
          pieceCid,
          bytesReceived: metrics.responseSize,
          pieceBytes: null,
          latencyMs: metrics.totalTime,
          ttfbMs: metrics.ttfb,
          throughputBps,
          statusCode: metrics.statusCode,
          httpSuccess: isHttpSuccess,
          commPValid: false,
          errorMessage: `CommP mismatch: bytes do not match ${pieceCid}`,
        };
      }

      this.logger.debug({
        event: "piece_fetch_success",
        message: "Piece fetched successfully",
        pieceCid,
        spAddress,
        network,
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
        httpSuccess: isHttpSuccess,
        commPValid,
      };
    } catch (error) {
      const aborted = signal?.aborted === true;
      this.logger.warn({
        event: "piece_fetch_failed",
        message: "Piece fetch threw an error",
        url,
        pieceCid,
        spAddress,
        network,
        aborted,
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
        httpSuccess: false,
        commPValid: false,
        errorMessage: error instanceof Error ? error.message : String(error),
        aborted,
      };
    }
  }

  /**
   * Compute the piece CID (sha2-256-trunc254-padded) of the retrieved bytes and compare
   * against the expected CID. Returns false on parse failure, computation failure, or mismatch.
   */
  private async validateCommP(bytes: Buffer, pieceCid: string): Promise<boolean> {
    const expected = Piece.tryFrom(pieceCid);
    if (!expected) {
      this.logger.warn({
        event: "commp_invalid_piece_cid",
        message: "Cannot parse expected piece CID for CommP validation",
        pieceCid,
      });
      return false;
    }

    try {
      const computed = await Piece.calculate(bytes);
      const matches = Piece.equals(expected, computed);
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
