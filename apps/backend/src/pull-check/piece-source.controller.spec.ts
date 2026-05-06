import { Readable, Writable } from "node:stream";
import { Test } from "@nestjs/testing";
import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { HostedPieceRegistry } from "./hosted-piece.registry.js";
import { PieceSourceController } from "./piece-source.controller.js";
import { PullCheckService } from "./pull-check.service.js";
import type { HostedPieceRegistration } from "./pull-check.types.js";

function makeRegistration(overrides: Partial<HostedPieceRegistration> = {}): HostedPieceRegistration {
  return {
    pieceCid: "bafk-test",
    filePath: "/tmp/test.bin",
    fileName: "test.bin",
    byteLength: 4,
    contentType: "application/octet-stream",
    expiresAt: new Date(Date.now() + 60_000),
    cleanedUp: false,
    ...overrides,
  };
}

/**
 * Fake express `Response` that is also a `Writable`, so `stream.pipe(res)`
 * works without a real HTTP layer. The controller only calls `setHeader`,
 * `status`, `send`, and `destroy`; we spy on those and let pipe write into
 * the sink to verify the body.
 */
type FakeResponse = Writable & {
  headersSent: boolean;
  chunks: Buffer[];
  setHeader: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
};

function makeResponse(): FakeResponse {
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk, _encoding, cb) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      cb();
    },
  }) as FakeResponse;
  sink.headersSent = false;
  sink.chunks = chunks;
  sink.setHeader = vi.fn();
  sink.status = vi.fn().mockReturnValue(sink);
  sink.send = vi.fn().mockReturnValue(sink);
  return sink;
}

function asResponse(res: FakeResponse): Response {
  return res as unknown as Response;
}

async function setup(opts: {
  opened?: ReturnType<PullCheckService["openHostedPieceStream"]>;
  knownEntry?: HostedPieceRegistration | null;
}) {
  const pullCheckService = {
    openHostedPieceStream: vi.fn().mockReturnValue(opts.opened ?? null),
  };
  const hostedPieceRegistry = {
    resolveAny: vi.fn().mockReturnValue(opts.knownEntry ?? null),
    markFirstByte: vi.fn(),
  };

  const module = await Test.createTestingModule({
    controllers: [PieceSourceController],
    providers: [
      { provide: PullCheckService, useValue: pullCheckService },
      { provide: HostedPieceRegistry, useValue: hostedPieceRegistry },
    ],
  }).compile();

  const controller = module.get(PieceSourceController);
  return { controller, pullCheckService, hostedPieceRegistry };
}

describe("PieceSourceController", () => {
  it("returns 404 when pieceCid is missing or empty", async () => {
    const { controller } = await setup({});
    const res = makeResponse();

    // servePiece throws a NestJS NotFoundException synchronously; it is not async.
    expect(() => controller.servePiece("", asResponse(res))).toThrow(/pieceCid is required/);
    expect(() => controller.servePiece("   ", asResponse(res))).toThrow(/pieceCid is required/);
  });

  it("returns 404 when no registration exists for the pieceCid", async () => {
    const { controller, pullCheckService, hostedPieceRegistry } = await setup({});
    const res = makeResponse();

    controller.servePiece("bafk-unknown", asResponse(res));

    expect(pullCheckService.openHostedPieceStream).toHaveBeenCalledWith("bafk-unknown");
    expect(hostedPieceRegistry.resolveAny).toHaveBeenCalledWith("bafk-unknown");
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith("Hosted piece source not found");
  });

  it("returns 410 when the registration exists but is no longer active", async () => {
    const cleaned = makeRegistration({ cleanedUp: true });
    const { controller } = await setup({ opened: null, knownEntry: cleaned });
    const res = makeResponse();

    controller.servePiece(cleaned.pieceCid, asResponse(res));

    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.send).toHaveBeenCalledWith("Hosted piece source has expired or been cleaned up");
  });

  it("streams the piece, sets headers, and marks first byte on the first chunk", async () => {
    const registration = makeRegistration();
    const stream = Readable.from([Buffer.from("ABCD")]);
    const { controller, hostedPieceRegistry } = await setup({
      opened: { registration, stream } as ReturnType<PullCheckService["openHostedPieceStream"]>,
    });
    const res = makeResponse();
    const pipeSpy = vi.spyOn(stream, "pipe");

    controller.servePiece(registration.pieceCid, asResponse(res));

    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/octet-stream");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Length", "4");
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(res.setHeader).toHaveBeenCalledWith("X-Pull-Check-Piece-CID", registration.pieceCid);
    expect(pipeSpy).toHaveBeenCalledTimes(1);

    // Wait for the stream to fully drain into our fake Writable sink.
    await new Promise<void>((resolve) => res.once("finish", resolve));

    expect(hostedPieceRegistry.markFirstByte).toHaveBeenCalledTimes(1);
    expect(hostedPieceRegistry.markFirstByte).toHaveBeenCalledWith(registration.pieceCid, expect.any(Date));
    expect(Buffer.concat(res.chunks).toString()).toBe("ABCD");
  });

  it("sends a 500 response when the stream errors before headers are sent", () => {
    const registration = makeRegistration();
    const stream = new Readable({ read() {} });
    const opened = { registration, stream } as ReturnType<PullCheckService["openHostedPieceStream"]>;
    const res = makeResponse();

    return setup({ opened }).then(({ controller }) => {
      controller.servePiece(registration.pieceCid, asResponse(res));

      stream.destroy(new Error("boom"));
      stream.emit("error", new Error("boom"));

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith("Failed to stream hosted piece");
    });
  });

  it("destroys the response when the stream errors after headers are sent", async () => {
    const registration = makeRegistration();
    const stream = new Readable({ read() {} });
    const opened = { registration, stream } as ReturnType<PullCheckService["openHostedPieceStream"]>;
    const res = makeResponse();
    res.headersSent = true;
    // Mock the real destroy to keep Writable from re-emitting the error as an
    // unhandled event; we only need to assert the controller forwarded it.
    const destroySpy = vi.spyOn(res, "destroy").mockImplementation(() => res);

    const { controller } = await setup({ opened });
    controller.servePiece(registration.pieceCid, asResponse(res));
    const error = new Error("late-boom");
    stream.emit("error", error);

    expect(destroySpy).toHaveBeenCalledWith(error);
  });
});
