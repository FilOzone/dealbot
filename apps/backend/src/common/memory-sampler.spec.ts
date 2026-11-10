import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Worker as WorkerThread } from "node:worker_threads";
import type { ConfigService } from "@nestjs/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IConfig } from "../config/index.js";
import {
  MEMORY_WATCHER_SOURCE,
  MemorySamplerService,
  type MemoryWatcherOptions,
  setJobStage,
  trackJob,
} from "./memory-sampler.js";

const mocks = vi.hoisted(() => ({
  postMessage: vi.fn(),
  constructed: vi.fn(),
}));

vi.mock("node:worker_threads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:worker_threads")>()),
  Worker: class {
    constructor(...args: unknown[]) {
      mocks.constructed(...args);
    }
    on = vi.fn();
    unref = vi.fn();
    terminate = vi.fn().mockResolvedValue(0);
    postMessage = mocks.postMessage;
  },
}));

const MIB = 1024 * 1024;
const TICK_MS = 250;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function createSampler(enabled: boolean): MemorySamplerService {
  const configService = { get: () => ({ memorySamplerEnabled: enabled }) };
  return new MemorySamplerService(configService as unknown as ConfigService<IConfig, true>);
}

describe("MemorySamplerService", () => {
  let sampler: MemorySamplerService;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.postMessage.mockClear();
    mocks.constructed.mockClear();
    vi.spyOn(process, "memoryUsage").mockReturnValue({
      rss: 300 * MIB,
      heapTotal: 80 * MIB,
      heapUsed: 40 * MIB,
      external: 20 * MIB,
      arrayBuffers: 10 * MIB,
    });
  });

  afterEach(async () => {
    await sampler.onModuleDestroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts nothing when disabled", () => {
    sampler = createSampler(false);
    sampler.onModuleInit();

    vi.advanceTimersByTime(TICK_MS * 8);

    expect(mocks.constructed).not.toHaveBeenCalled();
    expect(mocks.postMessage).not.toHaveBeenCalled();
  });

  it("sends each memory sample to the watcher", () => {
    sampler = createSampler(true);
    sampler.onModuleInit();

    vi.advanceTimersByTime(TICK_MS);

    expect(mocks.postMessage).toHaveBeenCalledTimes(1);
    expect(mocks.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        rssMiB: 300,
        heapTotalMiB: 80,
        heapUsedMiB: 40,
        externalMiB: 20,
        arrayBuffersMiB: 10,
        jobs: [],
      }),
    );
  });

  it("reports how late a sample ran", () => {
    sampler = createSampler(true);
    sampler.onModuleInit();

    vi.setSystemTime(Date.now() + 1000);
    vi.advanceTimersByTime(TICK_MS);

    expect(mocks.postMessage).toHaveBeenCalledWith(expect.objectContaining({ loopLagMs: 1000 }));
  });

  it("includes running jobs and their stage until they finish", async () => {
    sampler = createSampler(true);
    sampler.onModuleInit();

    const running = deferred();
    const job = trackJob("deal", async () => {
      setJobStage("upload");
      await running.promise;
    });
    vi.advanceTimersByTime(TICK_MS);
    expect(mocks.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ jobs: [{ type: "deal", stage: "upload", runningMs: TICK_MS }] }),
    );

    running.resolve();
    await job;
    vi.advanceTimersByTime(TICK_MS);
    expect(mocks.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ jobs: [] }));
  });

  it("stops tracking a job that fails and keeps stages separate between jobs", async () => {
    sampler = createSampler(true);
    sampler.onModuleInit();

    await expect(trackJob("pull_check", () => Promise.reject(new Error("timeout")))).rejects.toThrow("timeout");
    const first = deferred();
    const second = deferred();
    const deal = trackJob("deal", () => first.promise);
    const retrieval = trackJob("retrieval", async () => {
      setJobStage("download");
      await second.promise;
    });

    vi.advanceTimersByTime(TICK_MS);
    expect(mocks.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        jobs: [
          { type: "deal", stage: null, runningMs: TICK_MS },
          { type: "retrieval", stage: "download", runningMs: TICK_MS },
        ],
      }),
    );

    first.resolve();
    second.resolve();
    await Promise.all([deal, retrieval]);
  });

  it("ignores a stage set outside a tracked job", () => {
    sampler = createSampler(false);
    expect(() => setJobStage("upload")).not.toThrow();
  });
});

describe("memory watcher thread", () => {
  let directory: string;
  let outputPath: string;
  let fd: number;
  let watcher: WorkerThread;

  async function startWatcher(overrides: Partial<MemoryWatcherOptions> = {}): Promise<void> {
    const { Worker: RealWorker } = await vi.importActual<typeof import("node:worker_threads")>("node:worker_threads");
    const workerData: MemoryWatcherOptions = { fd, thresholdBytes: 1, historySize: 3, intervalMs: 5, ...overrides };
    watcher = new RealWorker(MEMORY_WATCHER_SOURCE, { eval: true, workerData });
    await new Promise((resolve) => watcher.once("online", resolve));
  }

  function writtenLines(): { level: string; message: { event: string; id?: number; rssMiB?: number } }[] {
    return readFileSync(outputPath, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line));
  }

  function writtenSampleIds(): (number | undefined)[] {
    return writtenLines()
      .filter((line) => line.message.event === "memory_sample")
      .map((line) => line.message.id);
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "memory-watcher-"));
    outputPath = join(directory, "stdout");
    fd = openSync(outputPath, "a");
  });

  afterEach(async () => {
    await watcher.terminate();
    closeSync(fd);
    rmSync(directory, { recursive: true });
  });

  it("writes nothing below the threshold", async () => {
    await startWatcher({ thresholdBytes: Number.MAX_SAFE_INTEGER });
    watcher.postMessage({ id: 1 });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(writtenLines()).toEqual([]);
  });

  it("writes the buffered lead-up once, then only new samples", async () => {
    await startWatcher();
    watcher.postMessage({ id: 1 });
    watcher.postMessage({ id: 2 });
    await vi.waitFor(() => expect(writtenSampleIds()).toEqual([1, 2]));

    watcher.postMessage({ id: 3 });
    await vi.waitFor(() => expect(writtenSampleIds()).toEqual([1, 2, 3]));
    const rssHigh = writtenLines().find((entry) => entry.message.event === "memory_rss_high");
    expect(rssHigh?.level).toBe("warn");
    expect(rssHigh?.message.rssMiB).toBeGreaterThan(0);
  });

  it("keeps only the most recent samples before the threshold is reached", async () => {
    await startWatcher({ intervalMs: 150 });
    for (const id of [1, 2, 3, 4, 5]) watcher.postMessage({ id });

    await vi.waitFor(() => expect(writtenSampleIds()).toEqual([3, 4, 5]));
  });

  it("keeps writing while the main thread is blocked", async () => {
    await startWatcher();
    watcher.postMessage({ id: 1 });
    const blockedAt = writtenLines().length;

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);

    expect(writtenLines().length).toBeGreaterThan(blockedAt);
    expect(writtenSampleIds()).toEqual([1]);
  });
});
