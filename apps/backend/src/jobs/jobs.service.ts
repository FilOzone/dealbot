import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import PgBoss from "pg-boss";
import type { Counter, Gauge, Histogram } from "prom-client";
import type { Repository } from "typeorm";
import type { IConfig } from "../config/app.config.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { DealService } from "../deal/deal.service.js";
import { MetricsSchedulerService } from "../metrics/services/metrics-scheduler.service.js";
import { RetrievalService } from "../retrieval/retrieval.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { JobScheduleRepository } from "./repositories/job-schedule.repository.js";

type JobType = "deal" | "retrieval" | "metrics" | "metrics_cleanup";

type DealJobData = { spAddress: string; intervalSeconds: number };
type RetrievalJobData = { spAddress: string; intervalSeconds: number };
type MetricsJobData = { intervalSeconds: number };

type ScheduleRow = {
  id: number;
  job_type: JobType;
  sp_address: string;
  interval_seconds: number;
  next_run_at: string;
};

type PgBossSendOptions = PgBoss.PublishOptions;
type JobRunStatus = "success" | "error";

@Injectable()
export class JobsService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(JobsService.name);
  private boss: PgBoss | null = null;
  private bossErrorHandler?: (error: Error) => void;
  private schedulerInterval: ReturnType<typeof setInterval> | null = null;
  private tickPromise: Promise<void> | null = null;

  constructor(
    private readonly configService: ConfigService<IConfig, true>,
    @InjectRepository(StorageProvider)
    private readonly storageProviderRepository: Repository<StorageProvider>,
    private readonly jobScheduleRepository: JobScheduleRepository,
    private readonly dealService: DealService,
    private readonly retrievalService: RetrievalService,
    private readonly metricsSchedulerService: MetricsSchedulerService,
    private readonly walletSdkService: WalletSdkService,
    @InjectMetric("jobs_queued")
    private readonly jobsQueuedGauge: Gauge,
    @InjectMetric("jobs_retry_scheduled")
    private readonly jobsRetryScheduledGauge: Gauge,
    @InjectMetric("oldest_queued_age_seconds")
    private readonly oldestQueuedAgeGauge: Gauge,
    @InjectMetric("oldest_in_flight_age_seconds")
    private readonly oldestInFlightAgeGauge: Gauge,
    @InjectMetric("jobs_in_flight")
    private readonly jobsInFlightGauge: Gauge,
    @InjectMetric("jobs_enqueue_attempts_total")
    private readonly jobsEnqueueAttemptsCounter: Counter,
    @InjectMetric("jobs_started_total")
    private readonly jobsStartedCounter: Counter,
    @InjectMetric("jobs_completed_total")
    private readonly jobsCompletedCounter: Counter,
    @InjectMetric("job_duration_seconds")
    private readonly jobDuration: Histogram,
  ) {}

  /**
   * Initializes the scheduler.
   * If pg-boss mode is enabled, it ensures wallets are ready (unless chain disabled),
   * starts pg-boss, registers workers, and starts the scheduler polling loop.
   */
  async onModuleInit(): Promise<void> {
    if (!this.isPgBossEnabled()) {
      return;
    }

    this.logger.log("pg-boss mode enabled; initializing job scheduler");

    if (process.env.DEALBOT_DISABLE_CHAIN !== "true") {
      await this.walletSdkService.ensureWalletAllowances();
      await this.walletSdkService.loadProviders();
    }
    await this.startBoss();
    if (!this.boss) {
      this.logger.error("pg-boss failed to start; job scheduler is disabled.");
      return;
    }
    this.registerWorkers();

    await this.tick();
    this.schedulerInterval = setInterval(() => {
      void this.tick();
    }, this.schedulerPollMs());
  }

  /**
   * Cleans up resources on shutdown.
   * Stops the polling loop and gracefully stops pg-boss.
   */
  async onApplicationShutdown(): Promise<void> {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
    if (this.tickPromise) {
      await this.tickPromise;
      this.tickPromise = null;
    }
    if (this.boss) {
      if (this.bossErrorHandler) {
        this.boss.off("error", this.bossErrorHandler);
        this.bossErrorHandler = undefined;
      }
      await this.boss.stop();
      this.boss = null;
    }
  }

  private isPgBossEnabled(): boolean {
    return (this.configService.get("jobs")?.mode ?? "cron") === "pgboss";
  }

  private schedulerPollMs(): number {
    const seconds = this.configService.get("jobs")?.schedulerPollSeconds ?? 300;
    return Math.max(1000, seconds * 1000);
  }

  private catchupMaxEnqueue(): number {
    return Math.max(1, this.configService.get("jobs")?.catchupMaxEnqueue ?? 10);
  }

  private catchupSpreadSeconds(): number {
    const hours = this.configService.get("jobs")?.catchupSpreadHours ?? 3;
    return Math.max(0, hours * 3600);
  }

  private perSpImmediateLimit(): number {
    return 1;
  }

  private lockRetrySeconds(): number {
    return Math.max(10, this.configService.get("jobs")?.lockRetrySeconds ?? 60);
  }

  private schedulePhaseSeconds(): number {
    return Math.max(0, this.configService.get("jobs")?.schedulePhaseSeconds ?? 0);
  }

  private enqueueJitterSeconds(): number {
    return Math.max(0, this.configService.get("jobs")?.enqueueJitterSeconds ?? 0);
  }

  private buildConnectionString(): string {
    const db = this.configService.get("database");
    // NOTE: db.password must be raw (not pre-encoded). Encode here for pg-boss/Postgres URI safety.
    const password = encodeURIComponent(db.password || "");
    return `postgres://${db.username}:${password}@${db.host}:${db.port}/${db.database}`;
  }

  private async startBoss(): Promise<void> {
    if (this.boss) return;
    const boss = new PgBoss({
      connectionString: this.buildConnectionString(),
      schema: "pgboss",
    });
    this.bossErrorHandler = (error: Error) => {
      this.logger.error(`pg-boss error: ${error.message}`, error.stack);
    };
    boss.on("error", this.bossErrorHandler);
    try {
      await boss.start();
      this.boss = boss;
    } catch (error) {
      boss.off("error", this.bossErrorHandler);
      this.bossErrorHandler = undefined;
      this.logger.error(`Failed to start pg-boss: ${error.message}`, error.stack);
    }
  }

  private registerWorkers(): void {
    if (!this.boss) return;

    void this.boss
      .subscribe("deal.run", async (job) => this.handleDealJob(job.data as DealJobData))
      .catch((error) => this.logger.error(`Failed to subscribe to deal.run: ${error.message}`, error.stack));
    void this.boss
      .subscribe("retrieval.run", async (job) => this.handleRetrievalJob(job.data as RetrievalJobData))
      .catch((error) => this.logger.error(`Failed to subscribe to retrieval.run: ${error.message}`, error.stack));
    void this.boss
      .subscribe("metrics.run", async (job) => this.handleMetricsJob(job.data as MetricsJobData))
      .catch((error) => this.logger.error(`Failed to subscribe to metrics.run: ${error.message}`, error.stack));
    void this.boss
      .subscribe("metrics.cleanup", async (job) => this.handleMetricsCleanupJob(job.data as MetricsJobData))
      .catch((error) => this.logger.error(`Failed to subscribe to metrics.cleanup: ${error.message}`, error.stack));
  }

  private async handleDealJob(data: DealJobData): Promise<void> {
    const spAddress = data.spAddress;
    const acquired = await this.tryAcquireSpLock(spAddress);
    if (!acquired) {
      await this.requeueJob("deal", "deal.run", data);
      return;
    }

    await this.recordJobExecution("deal", async () => {
      try {
        let provider = this.walletSdkService.getTestingProviders().find((p) => p.serviceProvider === spAddress);
        if (!provider) {
          if (process.env.DEALBOT_DISABLE_CHAIN !== "true") {
            await this.walletSdkService.loadProviders();
          }
          provider = this.walletSdkService.getTestingProviders().find((p) => p.serviceProvider === spAddress);
          if (!provider) {
            this.logger.warn(`Deal job skipped: provider ${spAddress} not found`);
            return "success";
          }
        }
        await this.dealService.createDealForProvider(provider, this.dealService.getTestingDealOptions());
        return "success";
      } catch (error) {
        this.logger.error(`Deal job failed for ${spAddress}: ${error.message}`, error.stack);
        // Jobs are not retried once attempted; failures are handled by the next schedule tick.
        throw error;
      } finally {
        try {
          await this.releaseSpLock(spAddress);
        } catch (releaseError) {
          this.logger.error(
            `Failed to release deal lock for ${spAddress}: ${releaseError.message}`,
            releaseError.stack,
          );
        }
      }
    });
  }

  private async handleRetrievalJob(data: RetrievalJobData): Promise<void> {
    const spAddress = data.spAddress;
    const acquired = await this.tryAcquireSpLock(spAddress);
    if (!acquired) {
      await this.requeueJob("retrieval", "retrieval.run", data);
      return;
    }

    await this.recordJobExecution("retrieval", async () => {
      try {
        const timeoutsConfig = this.configService.get("timeouts");
        const intervalMs = data.intervalSeconds * 1000;
        const timeoutMs = Math.max(10000, intervalMs - timeoutsConfig.retrievalTimeoutBufferMs);
        const httpTimeoutMs = Math.max(timeoutsConfig.httpRequestTimeoutMs, timeoutsConfig.http2RequestTimeoutMs);

        if (timeoutMs < httpTimeoutMs) {
          this.logger.warn(
            `Retrieval interval (${intervalMs}ms) minus buffer (${timeoutsConfig.retrievalTimeoutBufferMs}ms) yields ${timeoutMs}ms, ` +
              `which is less than the HTTP timeout (${httpTimeoutMs}ms). ` +
              "Retrieval runs may be skipped unless the interval or timeouts are adjusted.",
          );
        }

        await this.retrievalService.performRandomRetrievalForProvider(spAddress, timeoutMs);
        return "success";
      } catch (error) {
        this.logger.error(`Retrieval job failed for ${spAddress}: ${error.message}`, error.stack);
        // Jobs are not retried once attempted; failures are handled by the next schedule tick.
        throw error;
      } finally {
        try {
          await this.releaseSpLock(spAddress);
        } catch (releaseError) {
          this.logger.error(
            `Failed to release retrieval lock for ${spAddress}: ${releaseError.message}`,
            releaseError.stack,
          );
        }
      }
    });
  }

  private async handleMetricsJob(data: MetricsJobData): Promise<void> {
    void data;
    await this.recordJobExecution("metrics", async () => {
      await this.metricsSchedulerService.aggregateDailyMetrics();
      await this.metricsSchedulerService.refreshWeeklyPerformance();
      await this.metricsSchedulerService.refreshAllTimePerformance();
      return "success";
    });
  }

  private async handleMetricsCleanupJob(data: MetricsJobData): Promise<void> {
    void data;
    await this.recordJobExecution("metrics_cleanup", async () => {
      await this.metricsSchedulerService.cleanupOldMetrics({ allowWhenPgBoss: true });
      return "success";
    });
  }

  /**
   * Requeues a job when we fail to acquire the per-provider lock.
   */
  private async requeueJob(jobType: JobType, name: string, data: DealJobData | RetrievalJobData): Promise<void> {
    if (!this.boss) return;
    const startAfter = new Date(Date.now() + this.lockRetrySeconds() * 1000);
    try {
      // We only requeue on lock contention; once a job starts, we do not retry it.
      const options: PgBossSendOptions = { startAfter, retryLimit: 0 };
      await this.boss.publish(name, data, options);
      this.jobsEnqueueAttemptsCounter.inc({ job_type: jobType, outcome: "success" });
    } catch (error) {
      this.logger.warn(`Failed to requeue ${name}: ${error.message}`);
      this.jobsEnqueueAttemptsCounter.inc({ job_type: jobType, outcome: "error" });
    }
  }

  private async tryAcquireSpLock(spAddress: string): Promise<boolean> {
    return this.jobScheduleRepository.acquireAdvisoryLock(spAddress);
  }

  private async releaseSpLock(spAddress: string): Promise<void> {
    await this.jobScheduleRepository.releaseAdvisoryLock(spAddress);
  }

  /**
   * Main scheduler tick.
   * Runs `ensureScheduleRows` to sync providers to the DB, and `enqueueDueJobs` to process pending schedules.
   * Ensures only one tick runs at a time locally.
   */
  private async tick(): Promise<void> {
    if (this.tickPromise) {
      this.logger.warn("Previous pg-boss scheduler tick still running; skipping");
      return;
    }
    this.tickPromise = this.runTick();
    try {
      await this.tickPromise;
    } finally {
      this.tickPromise = null;
    }
  }

  /**
   * Runs one scheduler tick and updates queue metrics.
   */
  private async runTick(): Promise<void> {
    try {
      await this.ensureScheduleRows();
      await this.enqueueDueJobs();
    } catch (error) {
      this.logger.error(`pg-boss scheduler core tick failed: ${error.message}`, error.stack);
    }

    try {
      await this.updateQueueMetrics();
    } catch (error) {
      this.logger.error(`pg-boss scheduler metrics update failed: ${error.message}`, error.stack);
    }
  }

  private getIntervalSecondsForRates(): {
    dealIntervalSeconds: number;
    retrievalIntervalSeconds: number;
    metricsIntervalSeconds: number;
    metricsCleanupIntervalSeconds: number;
  } {
    const scheduling = this.configService.get("scheduling");
    const jobsConfig = this.configService.get("jobs");

    const defaultDealsPerHour = 3600 / scheduling.dealIntervalSeconds;
    const defaultRetrievalsPerHour = 3600 / scheduling.retrievalIntervalSeconds;
    const defaultMetricsPerHour = 2;
    // Keep cleanup weekly to match legacy cron schedule unless explicitly changed in code.
    const defaultMetricsCleanupIntervalSeconds = 7 * 24 * 3600;

    const dealsPerHourRaw = jobsConfig?.dealsPerSpPerHour ?? defaultDealsPerHour;
    const retrievalsPerHourRaw = jobsConfig?.retrievalsPerSpPerHour ?? defaultRetrievalsPerHour;
    const metricsPerHourRaw = jobsConfig?.metricsPerHour ?? defaultMetricsPerHour;

    const dealsPerHour = dealsPerHourRaw > 0 ? dealsPerHourRaw : defaultDealsPerHour;
    const retrievalsPerHour = retrievalsPerHourRaw > 0 ? retrievalsPerHourRaw : defaultRetrievalsPerHour;
    const metricsPerHour = metricsPerHourRaw > 0 ? metricsPerHourRaw : defaultMetricsPerHour;

    const dealIntervalSeconds = Math.max(1, Math.round(3600 / dealsPerHour));
    const retrievalIntervalSeconds = Math.max(1, Math.round(3600 / retrievalsPerHour));
    const metricsIntervalSeconds = Math.max(1, Math.round(3600 / metricsPerHour));
    const metricsCleanupIntervalSeconds = defaultMetricsCleanupIntervalSeconds;

    return {
      dealIntervalSeconds,
      retrievalIntervalSeconds,
      metricsIntervalSeconds,
      metricsCleanupIntervalSeconds,
    };
  }

  /**
   * Syncs the "job_schedule_state" table with the current list of active providers.
   * - Inserts new rows for new providers.
   * - Updates intervals if config changed.
   * - Pauses rows for providers that are no longer active.
   * - Ensures global metrics jobs exist.
   */
  private async ensureScheduleRows(): Promise<void> {
    const now = new Date();
    const { dealIntervalSeconds, retrievalIntervalSeconds, metricsIntervalSeconds, metricsCleanupIntervalSeconds } =
      this.getIntervalSecondsForRates();

    const useOnlyApprovedProviders = this.configService.get("blockchain").useOnlyApprovedProviders;
    const providers = await this.storageProviderRepository.find({
      select: { address: true },
      where: useOnlyApprovedProviders ? { isActive: true, isApproved: true } : { isActive: true },
    });
    const providerAddresses = providers.map((provider) => provider.address);

    const phaseMs = this.schedulePhaseSeconds() * 1000;
    const dealStartAt = new Date(now.getTime() + phaseMs);
    const retrievalStartAt = new Date(now.getTime() + phaseMs);
    const metricsStartAt = new Date(now.getTime() + phaseMs);

    for (const address of providerAddresses) {
      await this.jobScheduleRepository.upsertSchedule("deal", address, dealIntervalSeconds, dealStartAt);
      await this.jobScheduleRepository.upsertSchedule("retrieval", address, retrievalIntervalSeconds, retrievalStartAt);
    }

    await this.jobScheduleRepository.pauseMissingProviders(providerAddresses);

    // Global metrics schedule (sp_address = '')
    await this.jobScheduleRepository.upsertSchedule("metrics", "", metricsIntervalSeconds, metricsStartAt);
    await this.jobScheduleRepository.upsertSchedule(
      "metrics_cleanup",
      "",
      metricsCleanupIntervalSeconds,
      metricsStartAt,
    );
  }

  /**
   * Queries the DB for jobs that are due (`next_run_at <= now`).
   * Enqueues them into pg-boss, respecting rate limits/jitter.
   * Updates the `next_run_at` in the DB upon successful enqueue.
   */
  private async enqueueDueJobs(): Promise<void> {
    if (!this.boss) return;

    const now = new Date();
    const catchupMax = this.catchupMaxEnqueue();
    const spreadSeconds = this.catchupSpreadSeconds();
    const immediateLimit = this.perSpImmediateLimit();

    await this.jobScheduleRepository.runTransaction(async (manager) => {
      const rows = await this.jobScheduleRepository.findDueSchedulesWithManager(manager, now);

      for (const row of rows) {
        const intervalMs = row.interval_seconds * 1000;
        if (intervalMs <= 0) continue;

        const nextRunAt = new Date(row.next_run_at);
        const diffMs = now.getTime() - nextRunAt.getTime();
        if (diffMs < 0) continue;

        // Calculate how many runs we missed (or are due)
        const runsDue = Math.floor(diffMs / intervalMs) + 1;
        if (runsDue <= 0) continue;

        const totalToEnqueue = Math.min(runsDue, catchupMax);
        const immediateCount = Math.min(totalToEnqueue, immediateLimit);
        const delayedCount = Math.max(0, totalToEnqueue - immediateCount);

        let successCount = 0;
        const jobName = this.mapJobName(row.job_type);
        const payload = this.mapJobPayload(row);

        // Enqueue immediate jobs
        for (let i = 0; i < immediateCount; i += 1) {
          if (await this.safeSend(row.job_type, jobName, payload, { startAfter: this.withJitter(now) })) {
            successCount += 1;
          }
        }

        // Enqueue delayed jobs (spread out to avoid thundering herd if many were missed)
        if (delayedCount > 0) {
          for (let i = 0; i < delayedCount; i += 1) {
            if (spreadSeconds > 0) {
              const offsetSeconds = Math.ceil(((i + 1) * spreadSeconds) / (delayedCount + 1));
              const startAfter = new Date(now.getTime() + offsetSeconds * 1000);
              if (await this.safeSend(row.job_type, jobName, payload, { startAfter: this.withJitter(startAfter) })) {
                successCount += 1;
              }
            } else if (await this.safeSend(row.job_type, jobName, payload, { startAfter: this.withJitter(now) })) {
              successCount += 1;
            }
          }
        }

        if (successCount > 0) {
          const newNextRunAt = new Date(nextRunAt.getTime() + successCount * intervalMs);
          await this.jobScheduleRepository.updateScheduleAfterRun(manager, row.id, newNextRunAt, now);
        }
      }
    });
  }

  private mapJobName(jobType: JobType): string {
    switch (jobType) {
      case "deal":
        return "deal.run";
      case "retrieval":
        return "retrieval.run";
      case "metrics":
        return "metrics.run";
      case "metrics_cleanup":
        return "metrics.cleanup";
      default: {
        const exhaustiveCheck: never = jobType;
        throw new Error(`Unhandled job type: ${exhaustiveCheck}`);
      }
    }
  }

  private mapJobPayload(row: ScheduleRow): DealJobData | RetrievalJobData | MetricsJobData {
    if (row.job_type === "deal" || row.job_type === "retrieval") {
      return { spAddress: row.sp_address, intervalSeconds: row.interval_seconds };
    }
    return { intervalSeconds: row.interval_seconds };
  }

  /**
   * Publishes a job to pg-boss and tracks enqueue attempts.
   */
  private async safeSend(
    jobType: JobType,
    name: string,
    data: DealJobData | RetrievalJobData | MetricsJobData,
    options?: PgBossSendOptions,
  ) {
    if (!this.boss) return false;
    try {
      // Disable retries so "attempted" jobs don't rerun; failures are handled by the next schedule tick.
      const finalOptions: PgBossSendOptions = { retryLimit: 0, ...options };
      await this.boss.publish(name, data, finalOptions);
      this.jobsEnqueueAttemptsCounter.inc({ job_type: jobType, outcome: "success" });
      return true;
    } catch (error) {
      this.logger.warn(`Failed to enqueue ${name}: ${error.message}`);
      this.jobsEnqueueAttemptsCounter.inc({ job_type: jobType, outcome: "error" });
      return false;
    }
  }

  private withJitter(base: Date): Date {
    const jitterSeconds = this.enqueueJitterSeconds();
    if (jitterSeconds <= 0) {
      return base;
    }
    const jitterMs = Math.floor(Math.random() * (jitterSeconds * 1000 + 1));
    return new Date(base.getTime() + jitterMs);
  }

  /**
   * Records handler start/end metrics around a job execution.
   */
  private async recordJobExecution(jobType: JobType, run: () => Promise<JobRunStatus>): Promise<void> {
    const startedAt = Date.now();
    this.jobsStartedCounter.inc({ job_type: jobType });
    try {
      const status = await run();
      const finishedAt = Date.now();
      this.jobDuration.observe({ job_type: jobType }, (finishedAt - startedAt) / 1000);
      this.jobsCompletedCounter.inc({ job_type: jobType, handler_result: status });
    } catch (error) {
      const finishedAt = Date.now();
      this.jobDuration.observe({ job_type: jobType }, (finishedAt - startedAt) / 1000);
      this.jobsCompletedCounter.inc({ job_type: jobType, handler_result: "error" });
      throw error;
    }
  }

  /**
   * Refreshes queue depth and age gauges from pg-boss tables.
   */
  private async updateQueueMetrics(): Promise<void> {
    const jobTypes: JobType[] = ["deal", "retrieval", "metrics", "metrics_cleanup"];
    for (const jobType of jobTypes) {
      this.jobsQueuedGauge.set({ job_type: jobType }, 0);
      this.jobsRetryScheduledGauge.set({ job_type: jobType }, 0);
      this.jobsInFlightGauge.set({ job_type: jobType }, 0);
      this.oldestQueuedAgeGauge.set({ job_type: jobType }, 0);
      this.oldestInFlightAgeGauge.set({ job_type: jobType }, 0);
    }

    const rows = await this.jobScheduleRepository.countBossJobStates(["created", "retry", "active"]);
    for (const row of rows) {
      const jobType = this.mapJobTypeFromName(row.name);
      if (!jobType) continue;
      if (row.state === "active") {
        this.jobsInFlightGauge.set({ job_type: jobType }, row.count);
      } else if (row.state === "retry") {
        this.jobsRetryScheduledGauge.set({ job_type: jobType }, row.count);
      } else {
        this.jobsQueuedGauge.set({ job_type: jobType }, row.count);
      }
    }

    const now = new Date();
    const queuedAges = await this.jobScheduleRepository.minBossJobAgeSecondsByState("created", now);
    for (const row of queuedAges) {
      const jobType = this.mapJobTypeFromName(row.name);
      if (!jobType) continue;
      this.oldestQueuedAgeGauge.set({ job_type: jobType }, Math.max(0, row.min_age_seconds ?? 0));
    }

    const activeAges = await this.jobScheduleRepository.minBossJobAgeSecondsByState("active", now);
    for (const row of activeAges) {
      const jobType = this.mapJobTypeFromName(row.name);
      if (!jobType) continue;
      this.oldestInFlightAgeGauge.set({ job_type: jobType }, Math.max(0, row.min_age_seconds ?? 0));
    }
  }

  /**
   * Maps a pg-boss job name to the internal job type.
   */
  private mapJobTypeFromName(name: string): JobType | null {
    switch (name) {
      case "deal.run":
        return "deal";
      case "retrieval.run":
        return "retrieval";
      case "metrics.run":
        return "metrics";
      case "metrics.cleanup":
        return "metrics_cleanup";
      default:
        return null;
    }
  }
}
