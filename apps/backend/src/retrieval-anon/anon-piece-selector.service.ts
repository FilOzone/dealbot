import { randomBytes } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { IConfig } from "../config/app.config.js";
import type { AnonPiecePool, SampleAnonPieceParams } from "../subgraph/subgraph.service.js";
import { SubgraphService } from "../subgraph/subgraph.service.js";
import type { AnonCandidatePiece } from "../subgraph/types.js";
import type { AnonPiece } from "./types.js";

/**
 * Number of most-recently-tested anonymous pieces to exclude from selection
 * to avoid immediately retesting the same piece. Piece CIDs are globally
 * unique and each one lives on a single SP's dataset, so scoping by CID
 * is equivalent to scoping by (SP, CID) for this workload.
 *
 * The buffer is process-local: a duplicate piece that gets retested shortly
 * after a restart is harmless (still a valid measurement, just less diverse).
 */
const RECENT_DEDUP_WINDOW = 500;

/**
 * Piece size buckets, in raw (unpadded) bytes. Weighted sampling across
 * these buckets keeps tests meaningful for bandwidth measurement without
 * locking out SPs whose corpus skews small or large.
 */
type SizeBucket = "small" | "medium" | "large";
type SizeRange = { min: bigint; max: bigint };

const MIB = 1024n * 1024n;

// All downloads are buffered in-memory, so we need to keep piece sizes reasonable
const SIZE_BUCKETS: Record<SizeBucket, SizeRange> = {
  small: { min: 1n * MIB, max: 20n * MIB - 1n },
  medium: { min: 20n * MIB, max: 100n * MIB - 1n },
  large: { min: 100n * MIB, max: 500n * MIB - 1n },
};

/** Weights for choosing a bucket per selection. Must sum to 1. */
const BUCKET_WEIGHTS: Record<SizeBucket, number> = {
  small: 0.2,
  medium: 0.5,
  large: 0.3,
};

/**
 * Probability the primary draw targets the withIPFSIndexing pool.
 * The rest of the time we sample across all FWSS pieces, so SPs can't
 * optimise only their CAR corpus.
 */
const IPFS_INDEXED_SAMPLE_RATE = 0.8;

@Injectable()
export class AnonPieceSelectorService {
  private readonly logger = new Logger(AnonPieceSelectorService.name);

  /** Bounded FIFO of recently-selected piece CIDs. Process-local; lost on restart. */
  private readonly recentlyTested = new Set<string>();
  private readonly recentlyTestedQueue: string[] = [];

  constructor(
    private readonly subgraphService: SubgraphService,
    private readonly configService: ConfigService<IConfig, true>,
  ) {}

  /**
   * Select an anonymous piece to test against the given SP.
   *
   * Strategy:
   * 1. Pick a size bucket by weighted random.
   * 2. Pick a pool (`indexed` 80% / `any` 20%).
   * 3. Generate a uniform-random sampleKey and query the subgraph for the
   *    smallest `Root.sampleKey ≥ $sampleKey` matching the filters.
   * 4. Drop the pick if `pdpPaymentEndEpoch` has passed or it was tested
   *    recently; redraw once.
   * 5. If still empty, fall back through: (same bucket, opposite pool) →
   *    (any bucket, indexed) → (any bucket, any).
   */
  async selectPieceForProvider(spAddress: string): Promise<AnonPiece | null> {
    const dealbotPayer = this.configService.get("blockchain", { infer: true }).walletAddress;

    const bucket = this.pickBucket();
    const pool: AnonPiecePool = Math.random() < IPFS_INDEXED_SAMPLE_RATE ? "indexed" : "any";

    const attempts: Array<{ bucket: SizeBucket | "any"; pool: AnonPiecePool }> = [
      { bucket: bucket, pool: pool },
      { bucket: bucket, pool: pool === "indexed" ? "any" : "indexed" },
      { bucket: "any", pool: "indexed" },
      { bucket: "any", pool: "any" },
    ];

    for (const attempt of attempts) {
      const piece = await this.drawPiece({
        spAddress,
        dealbotPayer,
        bucket: attempt.bucket,
        pool: attempt.pool,
      });

      if (piece) {
        this.rememberRecent(piece.pieceCid);
        this.logger.log({
          event: "anon_piece_selected",
          message: "Selected anonymous piece for retrieval test",
          spAddress,
          pieceCid: piece.pieceCid,
          dataSetId: piece.dataSetId,
          withIPFSIndexing: piece.withIPFSIndexing,
          bucket: attempt.bucket,
          pool: attempt.pool,
        });

        return {
          pieceCid: piece.pieceCid,
          dataSetId: piece.dataSetId,
          pieceId: piece.pieceId,
          serviceProvider: spAddress.toLowerCase(),
          withIPFSIndexing: piece.withIPFSIndexing,
          ipfsRootCid: piece.ipfsRootCid,
          rawSize: piece.rawSize,
        };
      }
    }

    this.logger.warn({
      event: "anon_no_candidates",
      message: "No anonymous piece found after all fallbacks",
      spAddress,
    });

    return null;
  }

  /**
   * Try to draw a piece for one (bucket, pool) combination. Up to two draws
   * with fresh sampleKeys, each filtered by dedup + epoch-termination.
   */
  private async drawPiece(args: {
    spAddress: string;
    dealbotPayer: string;
    bucket: SizeBucket | "any";
    pool: AnonPiecePool;
  }): Promise<AnonCandidatePiece | null> {
    const range = args.bucket === "any" ? fullRange() : SIZE_BUCKETS[args.bucket];

    for (let attempt = 0; attempt < 2; attempt++) {
      const params: SampleAnonPieceParams = {
        serviceProvider: args.spAddress,
        payer: args.dealbotPayer,
        sampleKey: randomSampleKey(),
        minSize: range.min.toString(),
        maxSize: range.max.toString(),
        pool: args.pool,
      };

      const piece = await this.subgraphService.sampleAnonPiece(params);
      if (!piece) {
        continue;
      }

      if (piece.pdpPaymentEndEpoch != null && piece.pdpPaymentEndEpoch <= BigInt(piece.indexedAtBlock)) {
        continue;
      }

      if (this.recentlyTested.has(piece.pieceCid)) {
        continue;
      }

      return piece;
    }

    return null;
  }

  private pickBucket(): SizeBucket {
    const r = Math.random();
    let acc = 0;
    for (const [name, weight] of Object.entries(BUCKET_WEIGHTS) as Array<[SizeBucket, number]>) {
      acc += weight;
      if (r < acc) {
        return name;
      }
    }
    return "medium";
  }

  /** Push a CID into the bounded FIFO; evict the oldest when at capacity. */
  private rememberRecent(pieceCid: string): void {
    if (this.recentlyTested.has(pieceCid)) {
      return;
    }

    this.recentlyTested.add(pieceCid);
    this.recentlyTestedQueue.push(pieceCid);

    while (this.recentlyTestedQueue.length > RECENT_DEDUP_WINDOW) {
      const evicted = this.recentlyTestedQueue.shift();
      if (evicted !== undefined) {
        this.recentlyTested.delete(evicted);
      }
    }
  }
}

/** Uniform-random 32-byte sort key as `0x`-prefixed hex. */
function randomSampleKey(): string {
  return `0x${randomBytes(32).toString("hex")}`;
}

/** The full size range (used when bucket fallback is "any"). */
function fullRange(): SizeRange {
  return { min: 0n, max: (1n << 63n) - 1n };
}
