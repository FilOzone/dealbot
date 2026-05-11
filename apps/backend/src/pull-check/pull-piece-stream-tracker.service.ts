import type { Readable } from "node:stream";
import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { IConfig, IPullPieceConfig } from "../config/app.config.js";

/**
 * Tracks active pull-piece streams to enforce global and per-pieceCid concurrency limits.
 * Prevents DoS attacks where nefarious actors spam the `/api/piece/:pieceCid` endpoint
 * with concurrent requests to overwhelm the server.
 */
@Injectable()
export class PullPieceStreamTracker {
  private readonly logger = new Logger(PullPieceStreamTracker.name);

  /** Total count of active streams across all pieceCids */
  private activeStreamCount = 0;

  /** Map of pieceCid -> count of active streams for that piece */
  private readonly streamsByPieceCid = new Map<string, number>();

  /** Weak set to track which streams have been cleaned up (prevents duplicate cleanup) */
  private readonly cleanedUpStreams = new WeakSet<Readable>();

  constructor(private readonly configService: ConfigService<IConfig, true>) {}

  /**
   * Check limits and atomically reserve a stream slot for the given pieceCid.
   * Throws ServiceUnavailableException if limits are exceeded.
   * On success the slot is incremented immediately; call releaseReservation if
   * the stream never materialises (e.g. piece not found, upstream error).
   */
  reserveStream(pieceCid: string): void {
    const config = this.getPullPieceConfig();

    // Check global concurrent stream limit
    if (this.activeStreamCount >= config.maxConcurrentStreams) {
      this.logger.warn({
        event: "pull_piece_stream_limit_global",
        message: "Global concurrent stream limit reached",
        activeStreams: this.activeStreamCount,
        maxConcurrentStreams: config.maxConcurrentStreams,
        pieceCid,
      });
      throw new ServiceUnavailableException("Server is at capacity. Please retry later.");
    }

    // Check per-pieceCid concurrent stream limit
    const currentStreamsForCid = this.streamsByPieceCid.get(pieceCid) ?? 0;
    if (currentStreamsForCid >= config.maxStreamsPerCid) {
      this.logger.warn({
        event: "pull_piece_stream_limit_per_cid",
        message: "Per-pieceCid concurrent stream limit reached",
        pieceCid,
        activeStreamsForCid: currentStreamsForCid,
        maxStreamsPerCid: config.maxStreamsPerCid,
      });
      throw new ServiceUnavailableException("Too many concurrent requests for this piece. Please retry later.");
    }

    // Reserve the slot atomically so concurrent requests see the updated count
    this.activeStreamCount++;
    this.streamsByPieceCid.set(pieceCid, currentStreamsForCid + 1);
  }

  /**
   * Release a previously reserved slot without an associated stream.
   * Call this when reserveStream succeeded but the stream never materialised
   * (piece not found, upstream error, etc.).
   */
  releaseReservation(pieceCid: string): void {
    if (this.activeStreamCount > 0) {
      this.activeStreamCount--;
    }
    const currentCount = this.streamsByPieceCid.get(pieceCid);
    if (currentCount != null && currentCount > 0) {
      const newCount = currentCount - 1;
      if (newCount === 0) {
        this.streamsByPieceCid.delete(pieceCid);
      } else {
        this.streamsByPieceCid.set(pieceCid, newCount);
      }
    }
  }

  /**
   * Attach cleanup handlers to a stream whose slot was already reserved by reserveStream.
   * Call this immediately after creating the stream and before piping.
   */
  registerStream(pieceCid: string, stream: Readable): void {
    // Slot was already incremented by reserveStream; just log and attach handlers.
    this.logger.debug({
      event: "pull_piece_stream_registered",
      pieceCid,
      activeStreams: this.activeStreamCount,
      activeStreamsForCid: this.streamsByPieceCid.get(pieceCid) ?? 0,
    });

    // Attach cleanup handler to all stream termination events
    // Use a single cleanup function that guards against duplicate calls
    const cleanup = () => {
      this.unregisterStream(pieceCid, stream);
    };

    // Clean up on any stream termination event (streams can emit multiple events)
    stream.once("end", cleanup);
    stream.once("error", cleanup);
    stream.once("close", cleanup);
  }

  /**
   * Unregister a stream when it completes, errors, or closes.
   * This is called automatically by the stream event handlers.
   * Guards against duplicate cleanup using a WeakSet.
   */
  private unregisterStream(pieceCid: string, stream: Readable): void {
    // Prevent duplicate cleanup if this stream was already cleaned up
    if (this.cleanedUpStreams.has(stream)) {
      return;
    }
    this.cleanedUpStreams.add(stream);

    // Decrement global counter
    if (this.activeStreamCount > 0) {
      this.activeStreamCount--;
    }

    // Decrement per-pieceCid counter
    const currentCount = this.streamsByPieceCid.get(pieceCid);
    if (currentCount != null && currentCount > 0) {
      const newCount = currentCount - 1;
      if (newCount === 0) {
        this.streamsByPieceCid.delete(pieceCid);
      } else {
        this.streamsByPieceCid.set(pieceCid, newCount);
      }
    }

    this.logger.debug({
      event: "pull_piece_stream_unregistered",
      pieceCid,
      activeStreams: this.activeStreamCount,
      activeStreamsForCid: this.streamsByPieceCid.get(pieceCid) ?? 0,
    });
  }

  /**
   * Get current stream statistics for observability.
   */
  getStats(): { activeStreams: number; uniquePieceCids: number } {
    return {
      activeStreams: this.activeStreamCount,
      uniquePieceCids: this.streamsByPieceCid.size,
    };
  }

  private getPullPieceConfig(): IPullPieceConfig {
    return this.configService.get<IPullPieceConfig>("pullPiece", { infer: true });
  }
}
