import { Injectable, Logger } from "@nestjs/common";
import type { HostedPieceRegistration } from "./pull-check.types.js";

/**
 * In-memory registry of hosted piece sources backing pull-check requests.
 *
 * The first slice keeps this in process memory because there is one DealBot
 * API process serving `/api/piece/:pieceCid` and pull checks are bounded by
 * the configured hosted-piece TTL.
 */
@Injectable()
export class HostedPieceRegistry {
  private readonly logger = new Logger(HostedPieceRegistry.name);
  private readonly entries = new Map<string, HostedPieceRegistration>();

  register(registration: HostedPieceRegistration): void {
    this.entries.set(registration.pieceCid, registration);
    this.logger.debug({
      event: "hosted_piece_registered",
      message: "Registered hosted piece source",
      pieceCid: registration.pieceCid,
      expiresAt: registration.expiresAt.toISOString(),
      byteLength: registration.byteLength,
    });
  }

  /**
   * Resolve a hosted piece by CID. Returns null when the entry is missing,
   * already cleaned up, or has expired.
   */
  resolveActive(pieceCid: string, now: Date = new Date()): HostedPieceRegistration | null {
    const entry = this.entries.get(pieceCid);
    if (!entry) return null;
    if (entry.cleanedUp) return null;
    if (entry.expiresAt.getTime() <= now.getTime()) return null;
    return entry;
  }

  /**
   * Resolve a hosted piece by CID even when expired/cleaned-up. Used by the
   * controller to differentiate a 410 Gone from a 404 Not Found.
   */
  resolveAny(pieceCid: string): HostedPieceRegistration | null {
    return this.entries.get(pieceCid) ?? null;
  }

  markCleanedUp(pieceCid: string): void {
    const entry = this.entries.get(pieceCid);
    if (!entry) return;
    entry.cleanedUp = true;
    this.logger.debug({
      event: "hosted_piece_cleaned_up",
      message: "Marked hosted piece source as cleaned up",
      pieceCid,
    });
  }

  /**
   * Record the wall-clock time at which the `pullPieces` request was sent to
   * the SP. Idempotent: only the first call wins so that retried checks against
   * the same hosted piece do not skew first-byte measurements.
   */
  markPullSubmitted(pieceCid: string, at: Date): void {
    const entry = this.entries.get(pieceCid);
    if (!entry || entry.pullSubmittedAt) return;
    entry.pullSubmittedAt = at;
  }

  /**
   * Record the wall-clock time at which the SP read the first byte of the
   * hosted-piece stream. Idempotent: only the first read wins so that an SP
   * issuing retries after a failed connection does not overwrite the timestamp.
   */
  markFirstByte(pieceCid: string, at: Date): void {
    const entry = this.entries.get(pieceCid);
    if (!entry || entry.firstByteAt) return;
    entry.firstByteAt = at;
  }

  forget(pieceCid: string): void {
    this.entries.delete(pieceCid);
  }
}
