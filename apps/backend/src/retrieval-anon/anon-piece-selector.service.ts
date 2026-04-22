import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import type { IConfig } from "../config/app.config.js";
import { Retrieval } from "../database/entities/retrieval.entity.js";
import { SubgraphService } from "../subgraph/subgraph.service.js";
import type { FwssCandidatePiece } from "../subgraph/types.js";
import type { AnonPiece } from "./types.js";

/**
 * Number of most-recently-tested anonymous pieces to exclude from selection
 * to avoid immediately retesting the same piece. Piece CIDs are globally
 * unique and each one lives on a single SP's dataset, so scoping by CID
 * is equivalent to scoping by (SP, CID) for this workload.
 */
const RECENT_DEDUP_WINDOW = 500;

@Injectable()
export class AnonPieceSelectorService {
  private readonly logger = new Logger(AnonPieceSelectorService.name);

  constructor(
    private readonly subgraphService: SubgraphService,
    private readonly configService: ConfigService<IConfig, true>,
    @InjectRepository(Retrieval)
    private readonly retrievalRepository: Repository<Retrieval>,
  ) {}

  /**
   * Select an anonymous piece to test against the given SP.
   *
   * Queries the FWSS subgraph for candidate pieces, filters out pieces
   * tested in the last RECENT_DEDUP_WINDOW anonymous retrievals, and
   * picks one uniformly at random — preferring pieces with a declared
   * ipfsRootCID so CAR/IPNI validation has something meaningful to check.
   */
  async selectPieceForProvider(spAddress: string): Promise<AnonPiece | null> {
    const dealbotPayer = this.configService.get("blockchain", { infer: true }).walletAddress;
    const candidates = await this.subgraphService.listFwssCandidatePieces(spAddress, dealbotPayer);

    if (candidates.length === 0) {
      this.logger.warn({
        event: "anon_no_candidates",
        message: "FWSS subgraph returned no candidate pieces for SP",
        spAddress,
      });
      return null;
    }

    const recentlyTested = await this.loadRecentlyTestedPieceCids();
    const fresh = candidates.filter((c) => !recentlyTested.has(c.pieceCid));
    const pool = fresh.length > 0 ? fresh : candidates;

    const picked = this.pickPreferringIpfsIndexed(pool);

    this.logger.log({
      event: "anon_piece_selected",
      message: "Selected anonymous piece for retrieval test",
      spAddress,
      pieceCid: picked.pieceCid,
      dataSetId: picked.dataSetId,
      withIPFSIndexing: picked.withIPFSIndexing,
      candidateCount: candidates.length,
      freshCount: fresh.length,
    });

    return {
      pieceCid: picked.pieceCid,
      dataSetId: picked.dataSetId,
      pieceId: picked.pieceId,
      serviceProvider: spAddress.toLowerCase(),
      withIPFSIndexing: picked.withIPFSIndexing,
      ipfsRootCid: picked.ipfsRootCid,
    };
  }

  /**
   * Return the set of piece CIDs tested in the last RECENT_DEDUP_WINDOW
   * anonymous retrievals across all SPs.
   */
  private async loadRecentlyTestedPieceCids(): Promise<Set<string>> {
    const rows = await this.retrievalRepository
      .createQueryBuilder("r")
      .select("r.anon_piece_cid", "anonPieceCid")
      .where("r.is_anonymous = true")
      .andWhere("r.anon_piece_cid IS NOT NULL")
      .orderBy("r.created_at", "DESC")
      .limit(RECENT_DEDUP_WINDOW)
      .getRawMany<{ anonPieceCid: string }>();

    return new Set(rows.map((row) => row.anonPieceCid));
  }

  private pickPreferringIpfsIndexed(pool: FwssCandidatePiece[]): FwssCandidatePiece {
    const ipfsIndexed = pool.filter((p) => p.withIPFSIndexing && p.ipfsRootCid);
    const effective = ipfsIndexed.length > 0 ? ipfsIndexed : pool;
    return effective[Math.floor(Math.random() * effective.length)];
  }
}
