import { describe, expect, it } from "vitest";
import { HostedPieceRegistry } from "./hosted-piece.registry.js";
import type { HostedPieceRegistration } from "./pull-check.types.js";

function makeRegistration(overrides: Partial<HostedPieceRegistration> = {}): HostedPieceRegistration {
  return {
    pieceCid: "bafk-test",
    filePath: "/tmp/datasets/test.bin",
    fileName: "test.bin",
    byteLength: 1024,
    contentType: "application/octet-stream",
    expiresAt: new Date(Date.now() + 60_000),
    cleanedUp: false,
    ...overrides,
  };
}

describe("HostedPieceRegistry", () => {
  describe("register / resolveActive / resolveAny", () => {
    it("registers a piece and resolves it by CID", () => {
      const registry = new HostedPieceRegistry();
      const registration = makeRegistration();

      registry.register(registration);

      expect(registry.resolveActive(registration.pieceCid)).toBe(registration);
      expect(registry.resolveAny(registration.pieceCid)).toBe(registration);
    });

    it("resolveActive returns null for unknown pieceCid", () => {
      const registry = new HostedPieceRegistry();
      expect(registry.resolveActive("missing")).toBeNull();
      expect(registry.resolveAny("missing")).toBeNull();
    });

    it("resolveActive returns null when the registration has been cleaned up", () => {
      const registry = new HostedPieceRegistry();
      const registration = makeRegistration({ cleanedUp: true });
      registry.register(registration);

      expect(registry.resolveActive(registration.pieceCid)).toBeNull();
      // resolveAny still surfaces the cleaned-up entry so the controller can
      // distinguish 410 Gone from 404 Not Found.
      expect(registry.resolveAny(registration.pieceCid)).toBe(registration);
    });

    it("resolveActive returns null when the registration has expired", () => {
      const registry = new HostedPieceRegistry();
      const expired = makeRegistration({ expiresAt: new Date(2000, 0, 1) });
      registry.register(expired);

      expect(registry.resolveActive(expired.pieceCid)).toBeNull();
      expect(registry.resolveAny(expired.pieceCid)).toBe(expired);
    });

    it("resolveActive treats expiresAt boundary as expired", () => {
      const registry = new HostedPieceRegistry();
      const now = new Date("2030-01-01T00:00:00Z");
      const registration = makeRegistration({ expiresAt: now });
      registry.register(registration);

      expect(registry.resolveActive(registration.pieceCid, now)).toBeNull();
    });
  });

  describe("markCleanedUp", () => {
    it("marks the registration as cleaned up so resolveActive returns null", () => {
      const registry = new HostedPieceRegistry();
      const registration = makeRegistration();
      registry.register(registration);

      registry.markCleanedUp(registration.pieceCid);

      expect(registration.cleanedUp).toBe(true);
      expect(registry.resolveActive(registration.pieceCid)).toBeNull();
    });

    it("is a no-op for unknown pieceCid", () => {
      const registry = new HostedPieceRegistry();
      expect(() => registry.markCleanedUp("missing")).not.toThrow();
    });
  });

  describe("markPullSubmitted", () => {
    it("stamps the pullSubmittedAt timestamp on a registered piece", () => {
      const registry = new HostedPieceRegistry();
      const registration = makeRegistration();
      registry.register(registration);
      const submittedAt = new Date("2030-01-01T00:00:00Z");

      registry.markPullSubmitted(registration.pieceCid, submittedAt);

      expect(registration.pullSubmittedAt).toBe(submittedAt);
    });

    it("is idempotent: only the first call wins so SP retries do not skew measurements", () => {
      const registry = new HostedPieceRegistry();
      const registration = makeRegistration();
      registry.register(registration);
      const first = new Date("2030-01-01T00:00:00Z");
      const second = new Date("2030-01-01T00:00:01Z");

      registry.markPullSubmitted(registration.pieceCid, first);
      registry.markPullSubmitted(registration.pieceCid, second);

      expect(registration.pullSubmittedAt).toBe(first);
    });

    it("is a no-op for unknown pieceCid", () => {
      const registry = new HostedPieceRegistry();
      expect(() => registry.markPullSubmitted("missing", new Date())).not.toThrow();
    });
  });

  describe("markFirstByte", () => {
    it("stamps the firstByteAt timestamp on a registered piece", () => {
      const registry = new HostedPieceRegistry();
      const registration = makeRegistration();
      registry.register(registration);
      const firstByteAt = new Date("2030-01-01T00:00:00.500Z");

      registry.markFirstByte(registration.pieceCid, firstByteAt);

      expect(registration.firstByteAt).toBe(firstByteAt);
    });

    it("is idempotent: only the first SP read wins", () => {
      const registry = new HostedPieceRegistry();
      const registration = makeRegistration();
      registry.register(registration);
      const first = new Date("2030-01-01T00:00:00.500Z");
      const second = new Date("2030-01-01T00:00:01.000Z");

      registry.markFirstByte(registration.pieceCid, first);
      registry.markFirstByte(registration.pieceCid, second);

      expect(registration.firstByteAt).toBe(first);
    });

    it("is a no-op for unknown pieceCid", () => {
      const registry = new HostedPieceRegistry();
      expect(() => registry.markFirstByte("missing", new Date())).not.toThrow();
    });
  });

  describe("forget", () => {
    it("removes the registration entirely", () => {
      const registry = new HostedPieceRegistry();
      const registration = makeRegistration();
      registry.register(registration);

      registry.forget(registration.pieceCid);

      expect(registry.resolveAny(registration.pieceCid)).toBeNull();
    });

    it("is a no-op for unknown pieceCid", () => {
      const registry = new HostedPieceRegistry();
      expect(() => registry.forget("missing")).not.toThrow();
    });
  });
});
