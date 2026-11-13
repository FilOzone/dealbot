// Repro test for FilOzone/dealbot#765 (claim A): memory shape of one buffered
// sampled-retrieval piece download, and of 4 concurrent ones. Not PR quality.
// Run: pnpm vitest run src/sampled-retrieval/repro-765-memory.spec.ts
import { createServer, type Server } from "node:http";
import * as Piece from "@filoz/synapse-core/piece";
import { CarWriter } from "@ipld/car";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { varint } from "multiformats";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 } from "multiformats/hashes/sha2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpClientService } from "../http-client/http-client.service.js";
import { IpniVerificationService } from "../ipni/ipni-verification.service.js";
import { StorageProviderRepository } from "../providers/repositories/storage-provider.repository.js";
import { PieceValidationService } from "./piece-validation.service.js";
import { SAMPLED_MAX_PIECE_DOWNLOAD_BYTES } from "./sampled-piece-selector.service.js";

const MIB = 1024 * 1024;
const PIECE_MIB = 150;
const BLOCK_SIZE = 1 * MIB;

type Mem = ReturnType<typeof process.memoryUsage>;
const fields = ["rss", "heapUsed", "external", "arrayBuffers"] as const;

function sampler(intervalMs = 100) {
  const peak: Mem = process.memoryUsage();
  const base: Mem = { ...peak };
  const timer = setInterval(() => {
    const m = process.memoryUsage();
    for (const f of fields) peak[f] = Math.max(peak[f], m[f]);
  }, intervalMs);
  return {
    stop() {
      clearInterval(timer);
      const m = process.memoryUsage();
      for (const f of fields) peak[f] = Math.max(peak[f], m[f]);
      return { base, peak };
    },
  };
}

function fmt(label: string, { base, peak }: { base: Mem; peak: Mem }, downloadedBytes: number) {
  const mib = (n: number) => (n / MIB).toFixed(0).padStart(6);
  const lines = fields.map(
    (f) => `  ${f.padEnd(12)} base ${mib(base[f])} MiB  peak ${mib(peak[f])} MiB  delta ${mib(peak[f] - base[f])} MiB`,
  );
  const ratio = ((peak.rss - base.rss) / downloadedBytes).toFixed(2);
  const maxRss = process.resourceUsage().maxRSS * 1024; // KiB
  console.log(
    `\n[repro-765] ${label}  downloaded ${mib(downloadedBytes)} MiB  rss-delta/downloaded = ${ratio}  kernel maxRSS so far ${mib(maxRss)} MiB\n${lines.join("\n")}`,
  );
}

// One CAR = header + the same 1 MiB raw block repeated. Server holds ~1 MiB.
async function buildCarParts() {
  const data = Buffer.alloc(BLOCK_SIZE, 0);
  const cid = CID.create(1, raw.code, await sha256.digest(data));
  const { writer, out } = CarWriter.create([cid]);
  const chunks: Uint8Array[] = [];
  const collect = (async () => {
    for await (const c of out) chunks.push(c);
  })();
  await writer.put({ cid, bytes: data });
  await writer.close();
  await collect;
  const whole = Buffer.concat(chunks);
  const cidLen = cid.bytes.length;
  const sectionLen = cidLen + BLOCK_SIZE;
  const section = whole.subarray(whole.length - (varint.encodingLength(sectionLen) + sectionLen));
  const header = whole.subarray(0, whole.length - section.length);
  return { header, section, cid };
}

// Throttle so downloads take seconds and overlap, as against real SPs.
const MIB_PER_S = Number(process.env.REPRO_765_MIBPS ?? 50);

async function writeThrottled(res: NodeJS.WritableStream, parts: Iterable<Buffer>): Promise<void> {
  for (const part of parts) {
    if (!res.write(part)) await new Promise((r) => res.once("drain", r));
    await new Promise((r) => setTimeout(r, (part.length / MIB) * (1000 / MIB_PER_S)));
  }
}

describe("repro-765: sampled retrieval memory shape", () => {
  let server: Server;
  let baseUrl: string;
  let http: HttpClientService;
  let validation: PieceValidationService;
  let carCid: CID;

  beforeAll(async () => {
    const { header, section, cid } = await buildCarParts();
    carCid = cid;
    const pieceBytes = header.length + PIECE_MIB * section.length;
    server = createServer(async (_req, res) => {
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        connection: "close",
        "content-length": String(pieceBytes),
      });
      function* parts() {
        yield header;
        for (let i = 0; i < PIECE_MIB; i++) yield section;
      }
      await writeThrottled(res, parts());
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    baseUrl = `http://127.0.0.1:${port}`;

    const config = {
      get: (key: string) => {
        if (key === "timeouts")
          return { httpRequestTimeoutMs: 120_000, http2RequestTimeoutMs: 600_000, connectTimeoutMs: 10_000 };
        if (key === "retrieval") return { sampledBlockSampleCount: 5 };
        return undefined;
      },
    };
    const mod = await Test.createTestingModule({
      providers: [
        HttpClientService,
        PieceValidationService,
        { provide: HttpService, useValue: {} },
        { provide: ConfigService, useValue: config },
        { provide: StorageProviderRepository, useValue: {} },
        { provide: IpniVerificationService, useValue: {} },
      ],
    }).compile();
    http = mod.get(HttpClientService);
    validation = mod.get(PieceValidationService);
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  // Mirrors PieceRetrievalService.fetchPiece + SampledRetrievalService -> parseCar.
  async function fetchOne(withValidation: boolean): Promise<number> {
    const result = await http.requestWithMetrics<Buffer>(`${baseUrl}/piece/x`, {
      httpVersion: "2",
      maxBytes: SAMPLED_MAX_PIECE_DOWNLOAD_BYTES,
    });
    expect(result.limitExceeded).toBeFalsy();
    expect(result.aborted).toBeFalsy();
    const pieceBytes = Buffer.isBuffer(result.data) ? result.data : Buffer.from(result.data);
    expect(pieceBytes.length).toBeGreaterThan(PIECE_MIB * MIB);
    if (withValidation) {
      await Piece.calculate(pieceBytes); // validateCommP, streaming hasher
      const parsed = await validation.parseCar(pieceBytes);
      expect(parsed.status).toBe("success");
      expect((parsed as { blockCount: number }).blockCount).toBe(PIECE_MIB);
      expect((parsed as { sampledBlocks: { cid: CID }[] }).sampledBlocks[0].cid.toString()).toBe(carCid.toString());
    }
    return pieceBytes.length;
  }

  it("prints the production cap", () => {
    console.log(
      `[repro-765] SAMPLED_MAX_PIECE_DOWNLOAD_BYTES = ${SAMPLED_MAX_PIECE_DOWNLOAD_BYTES / MIB} MiB; piece served = ${PIECE_MIB} MiB (under cap, fully buffered)`,
    );
    expect(PIECE_MIB * MIB).toBeLessThan(SAMPLED_MAX_PIECE_DOWNLOAD_BYTES);
  });

  it("1 x 150 MiB, http only", async () => {
    const s = sampler();
    const n = await fetchOne(false);
    fmt("1 call, download+concat only", s.stop(), n);
  }, 300_000);

  it("1 x 150 MiB, http + commP + parseCar", async () => {
    const s = sampler();
    const n = await fetchOne(true);
    fmt("1 call, full path", s.stop(), n);
  }, 300_000);

  for (const n of [4, 6]) {
    it(`${n} x 150 MiB concurrent, http + commP + parseCar`, async () => {
      const s = sampler();
      const ns = await Promise.all(Array.from({ length: n }, () => fetchOne(true)));
      const r = s.stop();
      fmt(
        `${n} concurrent, full path`,
        r,
        ns.reduce((a, b) => a + b, 0),
      );
      console.log(
        `[repro-765] ${n} concurrent peak rss = ${(r.peak.rss / MIB).toFixed(0)} MiB (cgroup limit 2048 MiB)`,
      );
    }, 600_000);
  }
});
