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
    this.logger.log({
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
    this.logger.log({
      event: "hosted_piece_cleaned_up",
      message: "Marked hosted piece source as cleaned up",
      pieceCid,
    });
  }

  forget(pieceCid: string): void {
    this.entries.delete(pieceCid);
  }
}
