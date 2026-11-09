import { AsyncLocalStorage } from "node:async_hooks";
import { Worker } from "node:worker_threads";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { IConfig } from "../config/index.js";

const SAMPLE_INTERVAL_MS = 250;
const WATCH_INTERVAL_MS = 100;
const HISTORY_SIZE = 120;
const RSS_THRESHOLD_BYTES = 1024 * 1024 * 1024;
const BYTES_PER_MIB = 1024 * 1024;
const STDOUT_FD = 1;

type ActiveJob = { type: string; stage: string | null; startedAt: number };

type MemorySample = {
  sampledAt: string;
  loopLagMs: number;
  rssMiB: number;
  heapTotalMiB: number;
  heapUsedMiB: number;
  externalMiB: number;
  arrayBuffersMiB: number;
  jobs: { type: string; stage: string | null; runningMs: number }[];
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
let history = [];
let lastSampleAt = Date.now();

function write(fields) {
  const line = {
    level: "warn",
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
  for (const sample of history) {
    write({ event: "memory_sample", message: "Worker memory sample", ...sample });
  }
  history = [];
  write({
    event: "memory_rss_high",
    message: "Worker RSS above threshold",
    rssMiB: Math.round(rss / 1048576),
    msSinceMainThreadSample: Date.now() - lastSampleAt,
  });
}, intervalMs);
`;

const activeJobs = new Set<ActiveJob>();
const currentJob = new AsyncLocalStorage<ActiveJob>();

export async function trackJob<T>(type: string, run: () => Promise<T>): Promise<T> {
  const job: ActiveJob = { type, stage: null, startedAt: Date.now() };
  activeJobs.add(job);
  try {
    return await currentJob.run(job, run);
  } finally {
    activeJobs.delete(job);
  }
}

export function setJobStage(stage: string): void {
  const job = currentJob.getStore();
  if (job) job.stage = stage;
}

function toMiB(bytes: number): number {
  return Math.round(bytes / BYTES_PER_MIB);
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
      this.logger.warn({ event: "memory_watcher_failed", message: "Memory watcher stopped", error: String(error) });
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
    const sample: MemorySample = {
      sampledAt: new Date(now).toISOString(),
      loopLagMs: Math.max(0, now - this.lastSampleAt - SAMPLE_INTERVAL_MS),
      rssMiB: toMiB(usage.rss),
      heapTotalMiB: toMiB(usage.heapTotal),
      heapUsedMiB: toMiB(usage.heapUsed),
      externalMiB: toMiB(usage.external),
      arrayBuffersMiB: toMiB(usage.arrayBuffers),
      jobs: [...activeJobs].map((job) => ({ type: job.type, stage: job.stage, runningMs: now - job.startedAt })),
    };
    this.lastSampleAt = now;
    this.watcher?.postMessage(sample);
  }
}
