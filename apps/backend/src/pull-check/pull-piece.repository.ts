import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { PullPiece } from "../database/entities/pull-piece.entity.js";
import type { PullPieceRegistration } from "./pull-check.types.js";

/**
 * Postgres-backed registry of hosted piece sources backing pull-check requests.
 *
 * Persisting to the `hosted_pieces` table allows the API pod(s) to resolve
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
        expiresAt: registration.expiresAt,
        cleanedUp: false,
        pullSubmittedAt: null,
        firstByteAt: null,
      },
      ["pieceCid"],
    );
    this.logger.debug({
      event: "hosted_piece_registered",
      message: "Registered hosted piece source",
      pieceCid: registration.pieceCid,
      expiresAt: registration.expiresAt.toISOString(),
      size: `${registration.size} bytes`,
    });
  }

  /**
   * Resolve a hosted piece by CID. Returns null when the entry is missing,
   * already cleaned up, or has expired.
   */
  async resolveActive(pieceCid: string, now: Date = new Date()): Promise<PullPieceRegistration | null> {
    const row = await this.repo.findOneBy({ pieceCid });
    if (!row) return null;
    if (row.cleanedUp) return null;
    if (row.expiresAt.getTime() <= now.getTime()) return null;
    return this.toRegistration(row);
  }

  /**
   * Resolve a hosted piece by CID even when expired/cleaned-up. Used by the
   * controller to differentiate a 410 Gone from a 404 Not Found.
   */
  async resolveAny(pieceCid: string): Promise<PullPieceRegistration | null> {
    const row = await this.repo.findOneBy({ pieceCid });
    return row ? this.toRegistration(row) : null;
  }

  async markCleanedUp(pieceCid: string): Promise<void> {
    const result = await this.repo.update({ pieceCid, cleanedUp: false }, { cleanedUp: true });
    if (result.affected && result.affected > 0) {
      this.logger.debug({
        event: "hosted_piece_cleaned_up",
        message: "Marked hosted piece source as cleaned up",
        pieceCid,
      });
    }
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

  private toRegistration(row: PullPiece): PullPieceRegistration {
    return {
      pieceCid: row.pieceCid,
      providerAddress: row.providerAddress,
      key: row.key,
      size: row.size,
      expiresAt: row.expiresAt,
      cleanedUp: row.cleanedUp,
      pullSubmittedAt: row.pullSubmittedAt ?? undefined,
      firstByteAt: row.firstByteAt ?? undefined,
    };
  }
}
