import { AsyncLocalStorage } from "node:async_hooks";
import { Worker } from "node:worker_threads";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { IConfig } from "../config/index.js";
import { toStructuredError } from "./logging.js";

const SAMPLE_INTERVAL_MS = 250;
const WATCH_INTERVAL_MS = 100;
const HISTORY_SIZE = 120;
const RSS_THRESHOLD_BYTES = 2 ** 30;
const STDOUT_FD = 1;
const FINISHED_JOB_RETENTION_MS = 10_000;

type TrackedJob = {
  type: string;
  stage: string | null;
  startedAt: number;
  finished: { at: number; status: string } | null;
};

export type MemoryWatcherOptions = {
  fd: number;
  thresholdBytes: number;
  historySize: number;
  intervalMs: number;
};

// Runs off the main thread and writes straight to the fd, so it still reports while the main thread is blocked.
export const MEMORY_WATCHER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const { writeSync } = require("node:fs");
const { fd, thresholdBytes, historySize, intervalMs } = workerData;
const history = [];
let lastSampleAt = Date.now();

function write(fields) {
  const line = {
    level: "warn",
    pid: process.pid,
    timestamp: new Date().toISOString(),
    context: "MemorySamplerService",
    message: fields,
  };
  try {
    writeSync(fd, JSON.stringify(line) + "\\n");
  } catch {
    // A full stdout pipe must not kill the watcher; losing one line is acceptable.
  }
}

parentPort.on("message", (sample) => {
  lastSampleAt = Date.now();
  history.push(sample);
  if (history.length > historySize) history.shift();
});

setInterval(() => {
  const rss = process.memoryUsage.rss();
  if (rss < thresholdBytes) return;
  for (const sample of history.splice(0)) {
    write({ event: "memory_sample", message: "Worker memory sample", ...sample });
  }
  write({
    event: "memory_rss_high",
    message: "Worker RSS above threshold",
    rssMiB: Math.round(rss / 2 ** 20),
    msSinceMainThreadSample: Date.now() - lastSampleAt,
  });
}, intervalMs);
`;

const trackedJobs = new Set<TrackedJob>();
const currentJob = new AsyncLocalStorage<TrackedJob>();

export async function trackJob<T extends string>(type: string, run: () => Promise<T>): Promise<T> {
  const job: TrackedJob = { type, stage: null, startedAt: Date.now(), finished: null };
  trackedJobs.add(job);
  try {
    const status = await currentJob.run(job, run);
    job.finished = { at: Date.now(), status };
    return status;
  } catch (error) {
    job.finished = { at: Date.now(), status: "error" };
    throw error;
  } finally {
    // Work can outlive an aborted job, and #765 kills land seconds after an abort.
    setTimeout(() => trackedJobs.delete(job), FINISHED_JOB_RETENTION_MS).unref();
  }
}

export function setJobStage(stage: string): void {
  const job = currentJob.getStore();
  if (job) job.stage = stage;
}

function toMiB(bytes: number): number {
  return Math.round(bytes / 2 ** 20);
}

/** Temporary diagnostic for OOM kills (#765), enabled by DEALBOT_MEMORY_SAMPLER_ENABLED. */
@Injectable()
export class MemorySamplerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MemorySamplerService.name);
  private timer: NodeJS.Timeout | undefined;
  private watcher: Worker | undefined;
  private lastSampleAt = 0;

  constructor(private readonly configService: ConfigService<IConfig, true>) {}

  onModuleInit(): void {
    if (!this.configService.get("jobs", { infer: true }).memorySamplerEnabled) return;
    const options: MemoryWatcherOptions = {
      fd: STDOUT_FD,
      thresholdBytes: RSS_THRESHOLD_BYTES,
      historySize: HISTORY_SIZE,
      intervalMs: WATCH_INTERVAL_MS,
    };
    this.watcher = new Worker(MEMORY_WATCHER_SOURCE, { eval: true, workerData: options });
    this.watcher.on("error", (error) => {
      this.logger.warn({
        event: "memory_watcher_failed",
        message: "Memory watcher stopped",
        error: toStructuredError(error),
      });
    });
    this.watcher.unref();
    this.lastSampleAt = Date.now();
    this.timer = setInterval(() => this.sample(), SAMPLE_INTERVAL_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.watcher?.terminate();
  }

  private sample(): void {
    const now = Date.now();
    const usage = process.memoryUsage();
    const sample = {
      sampledAt: new Date(now).toISOString(),
      loopLagMs: Math.max(0, now - this.lastSampleAt - SAMPLE_INTERVAL_MS),
      rssMiB: toMiB(usage.rss),
      heapTotalMiB: toMiB(usage.heapTotal),
      heapUsedMiB: toMiB(usage.heapUsed),
      externalMiB: toMiB(usage.external),
      arrayBuffersMiB: toMiB(usage.arrayBuffers),
      jobs: Array.from(trackedJobs, (job) => ({
        type: job.type,
        stage: job.stage,
        status: job.finished?.status ?? "running",
        runningMs: (job.finished?.at ?? now) - job.startedAt,
        finishedMsAgo: job.finished ? now - job.finished.at : null,
      })),
    };
    this.lastSampleAt = now;
    this.watcher?.postMessage(sample);
  }
}
