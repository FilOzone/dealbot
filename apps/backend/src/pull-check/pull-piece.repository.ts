import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { PullPiece } from "../database/entities/pull-piece.entity.js";
import type { PullPieceRegistration } from "./pull-check.types.js";

/**
 * Postgres-backed registry of hosted piece sources backing pull-check requests.
 *
 * Persisting to the `pull_pieces` table allows the API pod(s) to resolve
 * registrations created by a separate worker pod in split-process deployments.
 */
@Injectable()
export class PullPieceRepository {
  private readonly logger = new Logger(PullPieceRepository.name);

  constructor(
    @InjectRepository(PullPiece)
    private readonly repo: Repository<PullPiece>,
  ) {}

  async register(registration: PullPieceRegistration): Promise<void> {
    await this.repo.upsert(
      {
        pieceCid: registration.pieceCid,
        providerAddress: registration.providerAddress,
        key: registration.key,
        size: registration.size,
        pullSubmittedAt: null,
        firstByteAt: null,
        expiresAt: registration.expiresAt,
      },
      ["pieceCid"],
    );
    this.logger.debug({
      event: "hosted_piece_registered",
      message: "Registered hosted piece source",
      pieceCid: registration.pieceCid,
      size: `${registration.size} bytes`,
    });
  }

  /**
   * Resolve a hosted piece by CID.
   */
  async resolve(pieceCid: string): Promise<PullPieceRegistration | null> {
    const row = await this.repo.findOneBy({ pieceCid });
    return row ? this.toRegistration(row) : null;
  }

  /**
   * Record the wall-clock time at which the `pullPieces` request was sent to
   * the SP. Idempotent: only the first call wins so that retried checks against
   * the same hosted piece do not skew first-byte measurements.
   */
  async markPullSubmitted(pieceCid: string, at: Date): Promise<void> {
    // Only set when currently null (idempotent first-write-wins)
    await this.repo
      .createQueryBuilder()
      .update(PullPiece)
      .set({ pullSubmittedAt: at })
      .where("piece_cid = :pieceCid AND pull_submitted_at IS NULL", { pieceCid })
      .execute();
  }

  /**
   * Record the wall-clock time at which the SP read the first byte of the
   * hosted-piece stream. Idempotent: only the first read wins so that an SP
   * issuing retries after a failed connection does not overwrite the timestamp.
   */
  async markFirstByte(pieceCid: string, at: Date): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(PullPiece)
      .set({ firstByteAt: at })
      .where("piece_cid = :pieceCid AND first_byte_at IS NULL", { pieceCid })
      .execute();
  }

  async forget(pieceCid: string): Promise<void> {
    await this.repo.delete({ pieceCid });
  }

  /**
   * Delete all rows whose `expires_at` is in the past.
   * Returns the number of rows removed.
   */
  async deleteExpired(): Promise<number> {
    const result = await this.repo.createQueryBuilder().delete().from(PullPiece).where("expires_at <= NOW()").execute();
    return result.affected ?? 0;
  }

  private toRegistration(row: PullPiece): PullPieceRegistration {
    return {
      pieceCid: row.pieceCid,
      providerAddress: row.providerAddress,
      key: row.key,
      size: row.size,
      pullSubmittedAt: row.pullSubmittedAt ?? undefined,
      firstByteAt: row.firstByteAt ?? undefined,
      expiresAt: row.expiresAt,
    };
  }
}
