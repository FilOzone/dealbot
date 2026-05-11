import { PassThrough } from "node:stream";
import { asPieceCID } from "@filoz/synapse-core/piece";
import { Controller, Get, Logger, NotFoundException, Param, Res, UseGuards } from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { PullCheckService } from "./pull-check.service.js";
import { PullPieceRepository } from "./pull-piece.repository.js";
import { PullPieceStreamTracker } from "./pull-piece-stream-tracker.service.js";
import { PullPieceThrottlerGuard } from "./pull-piece-throttler.guard.js";

/**
 * Serves the temporary pull-piece bytes that a storage provider must fetch
 * during a pull check. Bound to the same `/api/*` prefix as other DealBot HTTP
 * endpoints. The path component must end with `/piece/{pieceCid}` so that
 * SP-side pull workers can address the resource directly.
 */
@ApiTags("Pull Check")
@Controller("api")
export class PieceSourceController {
  private readonly logger = new Logger(PieceSourceController.name);

  constructor(
    private readonly pullCheckService: PullCheckService,
    private readonly pullPieceRepository: PullPieceRepository,
    private readonly streamTracker: PullPieceStreamTracker,
  ) {}

  @Get("piece/:pieceCid")
  @UseGuards(PullPieceThrottlerGuard)
  @ApiResponse({ status: 200, description: "Raw piece bytes streamed to the caller" })
  @ApiResponse({ status: 404, description: "No active pull piece exists for this pieceCid" })
  @ApiResponse({ status: 503, description: "Server is at capacity or too many concurrent requests for this piece" })
  async servePiece(@Param("pieceCid") pieceCid: string, @Res() res: Response): Promise<void> {
    if (!pieceCid || pieceCid.trim().length === 0) {
      throw new NotFoundException("pieceCid is required");
    }

    if (!asPieceCID(pieceCid)) {
      throw new NotFoundException("pieceCid is invalid");
    }

    // Reserve a slot atomically; throws 503 immediately if limits are already exceeded.
    this.streamTracker.reserveStream(pieceCid);

    // If the stream never materialises (piece not found or error), the reservation must
    // be released. streamAttached tracks whether registerStream took ownership.
    let streamAttached = false;
    try {
      const opened = await this.pullCheckService.openPullPieceStream(pieceCid);
      if (!opened) {
        this.logger.warn({
          event: "pull_check_piece_unknown",
          message: "Pull piece source not found",
          pieceCid,
        });
        res.status(404).send("Pull piece source not found");
        return;
      }

      const { registration, stream } = opened;

      // Attach cleanup handlers (slot already counted by reserveStream)
      this.streamTracker.registerStream(pieceCid, stream);
      streamAttached = true;

      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", registration.size.toString());
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Pull-Check-Piece-CID", registration.pieceCid);
      res.setHeader("Accept-ranges", "none");

      stream.on("error", (error) => {
        this.logger.error({
          event: "pull_check_piece_stream_error",
          message: "Failed to stream pull piece",
          pieceCid,
          error: error.message,
        });
        if (!res.headersSent) {
          res.status(500).send("Failed to stream pull piece");
          return;
        }
        res.destroy(error);
      });

      // If the SP client disconnects mid-transfer, destroy the source generator
      // immediately so the stream counter is released and memory is freed rather
      // than waiting for the synthetic generator to exhaust all bytesNeeded.
      res.on("close", () => {
        stream.destroy();
      });

      const pt = new PassThrough();
      // Capture the first-byte timestamp before piping (fire-and-forget DB write)
      pt.once("data", () => {
        void this.pullPieceRepository.markFirstByte(pieceCid, new Date());
      });

      stream.pipe(pt).pipe(res);
    } finally {
      if (!streamAttached) {
        this.streamTracker.releaseReservation(pieceCid);
      }
    }
  }
}
