import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IConfig, IPullPieceConfig } from "../config/app.config.js";
import { PullPieceStreamTracker } from "./pull-piece-stream-tracker.service.js";

/** Helper to wait for stream cleanup events to process */
async function waitForCleanup(): Promise<void> {
  // Wait for multiple event loop cycles to ensure cleanup handlers execute
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe("PullPieceStreamTracker", () => {
  let tracker: PullPieceStreamTracker;
  let mockConfigService: ConfigService<IConfig, true>;

  const defaultConfig: IPullPieceConfig = {
    pullChecksPerSpPerHour: 1,
    pullCheckJobTimeoutSeconds: 300,
    pullCheckPollIntervalSeconds: 2,
    pullCheckPieceSizeBytes: 10 * 1024 * 1024, // 10 MB
    maxConcurrentStreams: 50,
    maxStreamsPerCid: 3,
    pullPieceCleanupIntervalSeconds: 7 * 24 * 3600, // 7 days
  };

  beforeEach(() => {
    mockConfigService = {
      get: vi.fn().mockReturnValue(defaultConfig),
    } as unknown as ConfigService<IConfig, true>;

    tracker = new PullPieceStreamTracker(mockConfigService);
  });

  it("should allow starting a stream when under limits", () => {
    expect(() => tracker.reserveStream("baga1")).not.toThrow();
  });

  it("should throw when global concurrent stream limit is reached", () => {
    // Override config with low limit
    mockConfigService.get = vi.fn().mockReturnValue({
      maxConcurrentStreams: 2,
      maxStreamsPerCid: 3,
    });

    const stream1 = new PassThrough();
    const stream2 = new PassThrough();

    tracker.reserveStream("piece1");
    tracker.registerStream("piece1", stream1);

    tracker.reserveStream("piece2");
    tracker.registerStream("piece2", stream2);

    // Third stream should fail
    expect(() => tracker.reserveStream("piece3")).toThrow(ServiceUnavailableException);
    expect(() => tracker.reserveStream("piece3")).toThrow("Server is at capacity");

    // Clean up
    stream1.destroy();
    stream2.destroy();
  });

  it("should throw when per-pieceCid stream limit is reached", () => {
    // Override config with low per-cid limit
    mockConfigService.get = vi.fn().mockReturnValue({
      maxConcurrentStreams: 10,
      maxStreamsPerCid: 2,
    });

    const stream1 = new PassThrough();
    const stream2 = new PassThrough();

    tracker.reserveStream("piece1");
    tracker.registerStream("piece1", stream1);

    tracker.reserveStream("piece1");
    tracker.registerStream("piece1", stream2);

    // Third stream for same piece should fail
    expect(() => tracker.reserveStream("piece1")).toThrow(ServiceUnavailableException);
    expect(() => tracker.reserveStream("piece1")).toThrow("Too many concurrent requests for this piece");

    // Clean up
    stream1.destroy();
    stream2.destroy();
  });

  it("should unregister stream when stream ends", async () => {
    const stream = new PassThrough();

    tracker.reserveStream("piece1");
    tracker.registerStream("piece1", stream);

    let stats = tracker.getStats();
    expect(stats.activeStreams).toBe(1);
    expect(stats.uniquePieceCids).toBe(1);

    // Destroy the stream to trigger cleanup (end() alone doesn't work for unread PassThrough)
    stream.destroy();

    // Give event loop time to process cleanup
    await waitForCleanup();

    stats = tracker.getStats();
    expect(stats.activeStreams).toBe(0);
    expect(stats.uniquePieceCids).toBe(0);
  });

  it("should unregister stream when stream errors", async () => {
    const stream = new PassThrough();

    tracker.reserveStream("piece1");
    tracker.registerStream("piece1", stream);

    let stats = tracker.getStats();
    expect(stats.activeStreams).toBe(1);

    // Trigger error
    stream.destroy(new Error("Test error"));

    // Give event loop time to process cleanup
    await waitForCleanup();

    stats = tracker.getStats();
    expect(stats.activeStreams).toBe(0);
  });

  it("should track multiple pieces independently", () => {
    const stream1 = new PassThrough();
    const stream2 = new PassThrough();
    const stream3 = new PassThrough();

    tracker.reserveStream("piece1");
    tracker.registerStream("piece1", stream1);

    tracker.reserveStream("piece2");
    tracker.registerStream("piece2", stream2);

    tracker.reserveStream("piece3");
    tracker.registerStream("piece3", stream3);

    const stats = tracker.getStats();
    expect(stats.activeStreams).toBe(3);
    expect(stats.uniquePieceCids).toBe(3);

    // Clean up
    stream1.destroy();
    stream2.destroy();
    stream3.destroy();
  });

  it("should allow new streams after previous ones complete", async () => {
    // Override config with low limit
    mockConfigService.get = vi.fn().mockReturnValue({
      maxConcurrentStreams: 2,
      maxStreamsPerCid: 2,
    });

    const stream1 = new PassThrough();
    const stream2 = new PassThrough();

    tracker.reserveStream("piece1");
    tracker.registerStream("piece1", stream1);

    tracker.reserveStream("piece2");
    tracker.registerStream("piece2", stream2);

    // Would fail now
    expect(() => tracker.reserveStream("piece3")).toThrow();

    // Destroy one stream to free up capacity
    stream1.destroy();
    await waitForCleanup();

    // Should succeed now
    expect(() => tracker.reserveStream("piece3")).not.toThrow();

    // Clean up
    stream2.destroy();
  });
});
