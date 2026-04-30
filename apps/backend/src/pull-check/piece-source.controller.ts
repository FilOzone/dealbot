import { Controller, Get, Logger, NotFoundException, Param, Res } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { HostedPieceRegistry } from "./hosted-piece.registry.js";
import { PullCheckService } from "./pull-check.service.js";

/**
 * Serves the temporary hosted-piece bytes that a storage provider must fetch
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
    private readonly hostedPieceRegistry: HostedPieceRegistry,
  ) {}

  @Get("piece/:pieceCid")
  @ApiOperation({
    summary: "Stream a temporary hosted piece for an in-flight SP pull check",
  })
  @ApiResponse({ status: 200, description: "Raw piece bytes streamed to the caller" })
  @ApiResponse({ status: 404, description: "No active hosted piece exists for this pieceCid" })
  @ApiResponse({ status: 410, description: "Hosted piece existed but has expired or been cleaned up" })
  servePiece(@Param("pieceCid") pieceCid: string, @Res() res: Response): void {
    if (!pieceCid || pieceCid.trim().length === 0) {
      throw new NotFoundException("pieceCid is required");
    }

    const opened = this.pullCheckService.openHostedPieceStream(pieceCid);
    if (!opened) {
      const known = this.hostedPieceRegistry.resolveAny(pieceCid);
      if (known) {
        this.logger.warn({
          event: "pull_check_piece_gone",
          message: "Hosted piece source no longer active",
          pieceCid,
          cleanedUp: known.cleanedUp,
          expiresAt: known.expiresAt.toISOString(),
        });
        res.status(410).send("Hosted piece source has expired or been cleaned up");
        return;
      }
      this.logger.warn({
        event: "pull_check_piece_unknown",
        message: "Hosted piece source not found",
        pieceCid,
      });
      res.status(404).send("Hosted piece source not found");
      return;
    }

    const { registration, stream } = opened;
    res.setHeader("Content-Type", registration.contentType);
    res.setHeader("Content-Length", registration.byteLength.toString());
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Pull-Check-Piece-CID", registration.pieceCid);

    stream.on("error", (error) => {
      this.logger.error({
        event: "pull_check_piece_stream_error",
        message: "Failed to stream hosted piece",
        pieceCid,
        error: error.message,
      });
      if (!res.headersSent) {
        res.status(500).send("Failed to stream hosted piece");
        return;
      }
      res.destroy(error);
    });
    stream.pipe(res);
  }
}
