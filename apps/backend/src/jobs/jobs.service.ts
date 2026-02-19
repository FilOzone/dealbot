import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import { type Job, PgBoss, type SendOptions } from "pg-boss";
import type { Counter, Gauge, Histogram } from "prom-client";
import type { Repository } from "typeorm";
import { getMaintenanceWindowStatus } from "../common/maintenance-window.js";
import type { IConfig } from "../config/app.config.js";
import type { JobType } from "../database/entities/job-schedule-state.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { DealService } from "../deal/deal.service.js";
import { MetricsSchedulerService } from "../metrics/services/metrics-scheduler.service.js";
import { RetrievalService } from "../retrieval/retrieval.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { METRICS_CLEANUP_QUEUE, METRICS_QUEUE, PROVIDERS_REFRESH_QUEUE, SP_WORK_QUEUE } from "./job-queues.js";
import { JobScheduleRepository } from "./repositories/job-schedule.repository.js";

type SpJobType = "deal" | "retrieval";

type SpJobData = { jobType: SpJobType; spAddress: string; intervalSeconds: number };
type MetricsJobData = { intervalSeconds: number };
type ProvidersRefreshJobData = { intervalSeconds: number };
type SpJob = Job<SpJobData>;

type ScheduleRow = {
  id: number;
  job_type: JobType;
  sp_address: string;
  interval_seconds: number;
  next_run_at: string;
};

type JobRunStatus = "success" | "error" | "aborted";

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
    @InjectMetric("jobs_paused")
    private readonly jobsPausedGauge: Gauge,
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
    const runMode = this.configService.get("app")?.runMode ?? "both";
    const schedulerEnabled = runMode !== "worker" && (this.configService.get("jobs")?.pgbossSchedulerEnabled ?? true);
    const workersEnabled = runMode !== "api";

    if (process.env.DEALBOT_DISABLE_CHAIN !== "true") {
      await this.walletSdkService.ensureWalletAllowances();
      await this.walletSdkService.ensureProvidersLoaded();
    }
    await this.startBoss();
    if (!this.boss) {
      this.logger.error("pg-boss failed to start; job scheduler is disabled.");
      if (workersEnabled || schedulerEnabled) {
        this.logger.error("pg-boss is required for this run mode; exiting to trigger restart.");
        process.exit(1);
      }
      return;
    }
    if (workersEnabled) {
      this.registerWorkers();
    } else {
      this.logger.warn("pg-boss workers disabled; run mode is api.");
    }

    if (!schedulerEnabled) {
      this.logger.warn("pg-boss scheduler disabled; no enqueue loop will run.");
      if (!workersEnabled) {
        this.logger.warn("pg-boss workers disabled; no jobs will be processed.");
      }
      return;
    }

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

  private schedulePhaseSeconds(): number {
    return Math.max(0, this.configService.get("jobs")?.schedulePhaseSeconds ?? 0);
  }

  private pgbossPoolMax(): number {
    const poolMax = this.configService.get("jobs")?.pgbossPoolMax ?? 1;
    return Math.max(1, poolMax);
  }

  private buildConnectionString(): string {
    const db = this.configService.get("database");
    // NOTE: db.password must be raw (not pre-encoded). Encode here for pg-boss/Postgres URI safety.
    const password = encodeURIComponent(db.password || "");
    return `postgres://${db.username}:${password}@${db.host}:${db.port}/${db.database}`;
  }

  private async startBoss(): Promise<void> {
    if (this.boss) return;
    const poolMax = this.pgbossPoolMax();
    const runMode = this.configService.get("app")?.runMode ?? "both";
    const migrate = runMode !== "worker";
    const boss = new PgBoss({
      connectionString: this.buildConnectionString(),
      schema: "pgboss",
      max: poolMax,
      migrate,
    });
    this.bossErrorHandler = (error: Error) => {
      this.logger.error(`pg-boss error: ${error.message}`, error.stack);
    };
    boss.on("error", this.bossErrorHandler);
    try {
      await boss.start();
      await boss.createQueue(SP_WORK_QUEUE, { policy: "singleton" });
      this.boss = boss;
    } catch (error) {
      boss.off("error", this.bossErrorHandler);
      this.bossErrorHandler = undefined;
      this.logger.error(`Failed to start pg-boss: ${error.message}`, error.stack);
    }
  }

  private registerWorkers(): void {
    if (!this.boss) return;

    const jobsConfig = this.configService.get("jobs");
    const workerPollSeconds = Math.max(5, this.configService.get("jobs")?.workerPollSeconds ?? 60);
    const spConcurrency = Math.max(1, jobsConfig?.pgbossLocalConcurrency ?? 1);

    void this.boss
      .work<SpJobData, void>(
        SP_WORK_QUEUE,
        { batchSize: 1, localConcurrency: spConcurrency, pollingIntervalSeconds: workerPollSeconds },
        async ([job]) => {
          if (!job) {
            return;
          }
          if (job.data.jobType === "deal") {
            await this.handleDealJob(job);
            return;
          }
          if (job.data.jobType === "retrieval") {
            await this.handleRetrievalJob(job);
            return;
          }
          this.logger.warn(`Skipping unknown SP job type "${String(job.data.jobType)}" for ${job.data.spAddress}`);
        },
      )
      .catch((error) =>
        this.logger.error(`Failed to register worker for ${SP_WORK_QUEUE}: ${error.message}`, error.stack),
      );
    void this.boss
      .work<MetricsJobData, void>(
        METRICS_QUEUE,
        { batchSize: 1, pollingIntervalSeconds: workerPollSeconds },
        async ([job]) => this.handleMetricsJob(job.data),
      )
      .catch((error) => this.logger.error(`Failed to register worker for metrics.run: ${error.message}`, error.stack));
    void this.boss
      .work<MetricsJobData, void>(
        METRICS_CLEANUP_QUEUE,
        { batchSize: 1, pollingIntervalSeconds: workerPollSeconds },
        async ([job]) => this.handleMetricsCleanupJob(job.data),
      )
      .catch((error) =>
        this.logger.error(`Failed to register worker for metrics.cleanup: ${error.message}`, error.stack),
      );
    void this.boss
      .work(PROVIDERS_REFRESH_QUEUE, { batchSize: 1, pollingIntervalSeconds: workerPollSeconds }, async ([job]) =>
        this.handleProvidersRefreshJob(job.data as ProvidersRefreshJobData),
      )
      .catch((error) =>
        this.logger.error(`Failed to subscribe to ${PROVIDERS_REFRESH_QUEUE}: ${error.message}`, error.stack),
      );
  }

  private getMaintenanceWindowStatus(now: Date = new Date()) {
    const scheduling = this.configService.get("scheduling");
    return getMaintenanceWindowStatus(now, scheduling.maintenanceWindowsUtc, scheduling.maintenanceWindowMinutes);
  }

  private logMaintenanceSkip(taskLabel: string, windowLabel?: string) {
    const scheduling = this.configService.get("scheduling");
    const label = windowLabel ?? "unknown";
    this.logger.log(
      `Maintenance window active (${label} UTC, ${scheduling.maintenanceWindowMinutes}m); deferring ${taskLabel}`,
    );
  }

  private async handleDealJob(job: SpJob): Promise<void> {
    const data = job.data;
    const spAddress = data.spAddress;
    const now = new Date();
    const maintenance = this.getMaintenanceWindowStatus(now);
    if (maintenance.active) {
      this.logMaintenanceSkip(`deal job for ${spAddress}`, maintenance.window?.label);
      await this.deferJobForMaintenance("deal", data, maintenance, now);
      return;
    }

    // Create AbortController for job timeout enforcement
    const abortController = new AbortController();
    const timeoutSeconds = this.configService.get("jobs").dealJobTimeoutSeconds;
    const timeoutMs = Math.max(120000, timeoutSeconds * 1000);
    const effectiveTimeoutSeconds = Math.round(timeoutMs / 1000);
    const abortReason = new Error(`Deal job timeout (${effectiveTimeoutSeconds}s) for ${spAddress}`);
    const timeoutId = setTimeout(() => {
      abortController.abort(abortReason);
    }, timeoutMs);

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
        await this.dealService.createDealForProvider(provider, {
          ...this.dealService.getTestingDealOptions(),
          signal: abortController.signal,
        });
        return "success";
      } catch (error) {
        if (abortController.signal.aborted) {
          const reason = abortController.signal.reason;
          const reasonMessage = reason instanceof Error ? reason.message : String(reason ?? "");
          this.logger.error(
            reasonMessage
              ? `Deal job aborted: ${reasonMessage}`
              : `Deal job aborted after timeout (${effectiveTimeoutSeconds}s) for ${spAddress}`,
          );
          return "aborted";
        }
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        this.logger.error(`Deal job failed for ${spAddress}: ${errorMessage}`, errorStack);
        // Jobs are not retried once attempted; failures are handled by the next schedule tick.
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    });
  }

  private async handleRetrievalJob(job: SpJob): Promise<void> {
    const data = job.data;
    const spAddress = data.spAddress;
    const now = new Date();
    const maintenance = this.getMaintenanceWindowStatus(now);
    if (maintenance.active) {
      this.logMaintenanceSkip(`retrieval job for ${spAddress}`, maintenance.window?.label);
      await this.deferJobForMaintenance("retrieval", data, maintenance, now);
      return;
    }

    // Create AbortController for job timeout enforcement
    const abortController = new AbortController();
    const timeoutSeconds = this.configService.get("jobs").retrievalJobTimeoutSeconds;
    const timeoutMs = Math.max(60000, timeoutSeconds * 1000);
    const effectiveTimeoutSeconds = Math.round(timeoutMs / 1000);
    const abortReason = new Error(`Retrieval job timeout (${effectiveTimeoutSeconds}s) for ${spAddress}`);
    const timeoutId = setTimeout(() => {
      abortController.abort(abortReason);
    }, timeoutMs);

    await this.recordJobExecution("retrieval", async () => {
      try {
        await this.retrievalService.performRandomRetrievalForProvider(spAddress, abortController.signal);
        return "success";
      } catch (error) {
        if (abortController.signal.aborted) {
          const reason = abortController.signal.reason;
          const reasonMessage = reason instanceof Error ? reason.message : String(reason ?? "");
          this.logger.error(
            reasonMessage
              ? `Retrieval job aborted: ${reasonMessage}`
              : `Retrieval job aborted after timeout (${effectiveTimeoutSeconds}s) for ${spAddress}`,
          );
          return "aborted";
        }
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        this.logger.error(`Retrieval job failed for ${spAddress}: ${errorMessage}`, errorStack);
        // Jobs are not retried once attempted; failures are handled by the next schedule tick.
        throw error;
      } finally {
        clearTimeout(timeoutId);
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

  private async handleProvidersRefreshJob(data: ProvidersRefreshJobData): Promise<void> {
    void data;
    await this.recordJobExecution("providers_refresh", async () => {
      if (process.env.DEALBOT_DISABLE_CHAIN === "true") {
        this.logger.warn("Chain integration disabled; skipping provider refresh job.");
        return "success";
      }
      await this.walletSdkService.loadProviders();
      return "success";
    });
  }

  private maintenanceResumeAt(now: Date, maintenance: ReturnType<typeof getMaintenanceWindowStatus>): Date | null {
    if (!maintenance.active || !maintenance.window) {
      return null;
    }
    const scheduling = this.configService.get("scheduling");
    const durationMinutes = scheduling.maintenanceWindowMinutes;
    if (durationMinutes <= 0) {
      return null;
    }

    const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const startMinutes = maintenance.window.startMinutes;
    const endMinutes = startMinutes + durationMinutes;
    const baseDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);

    if (endMinutes < 24 * 60) {
      return new Date(baseDay + endMinutes * 60 * 1000);
    }

    const wrappedEnd = endMinutes - 24 * 60;
    if (nowMinutes >= startMinutes) {
      return new Date(baseDay + (24 * 60 + wrappedEnd) * 60 * 1000);
    }
    return new Date(baseDay + wrappedEnd * 60 * 1000);
  }

  private async deferJobForMaintenance(
    jobType: SpJobType,
    data: SpJobData,
    maintenance: ReturnType<typeof getMaintenanceWindowStatus>,
    now: Date,
  ): Promise<void> {
    const resumeAt = this.maintenanceResumeAt(now, maintenance);
    if (resumeAt == null) {
      return;
    }
    await this.safeSend(jobType, SP_WORK_QUEUE, data, { startAfter: resumeAt });
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
    providersRefreshIntervalSeconds: number;
  } {
    const scheduling = this.configService.get("scheduling");
    const jobsConfig = this.configService.get("jobs");

    const defaultDealsPerHour = 3600 / scheduling.dealIntervalSeconds;
    const defaultRetrievalsPerHour = 3600 / scheduling.retrievalIntervalSeconds;
    const defaultMetricsPerHour = 2;
    // Keep cleanup weekly to match legacy cron schedule unless explicitly changed in code.
    const defaultMetricsCleanupIntervalSeconds = 7 * 24 * 3600;
    const providersRefreshIntervalSeconds = 4 * 3600;

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
      providersRefreshIntervalSeconds,
    };
  }

  /**
   * Syncs the "job_schedule_state" table with the current list of active providers.
   * - Inserts new rows for new providers.
   * - Updates intervals if config changed.
   * - Pauses rows for providers that are no longer active.
   * - Ensures global metrics and provider refresh jobs exist.
   */
  private async ensureScheduleRows(): Promise<void> {
    const now = new Date();
    const {
      dealIntervalSeconds,
      retrievalIntervalSeconds,
      metricsIntervalSeconds,
      metricsCleanupIntervalSeconds,
      providersRefreshIntervalSeconds,
    } = this.getIntervalSecondsForRates();

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
    const providersRefreshStartAt = new Date(now.getTime() + phaseMs);

    for (const address of providerAddresses) {
      await this.jobScheduleRepository.upsertSchedule("deal", address, dealIntervalSeconds, dealStartAt);
      await this.jobScheduleRepository.upsertSchedule("retrieval", address, retrievalIntervalSeconds, retrievalStartAt);
    }

    if (providerAddresses.length > 0) {
      const deletedAddresses = await this.jobScheduleRepository.deleteSchedulesForInactiveProviders(providerAddresses);
      if (deletedAddresses.length > 0) {
        this.logger.warn(
          `Deleted job schedules for ${deletedAddresses.length} providers no longer in active list: [${deletedAddresses.join(", ")}]`,
        );
      }
    } else {
      this.logger.warn(
        "No active providers found in database; skipping job schedule deletion to prevent accidental mass-deletion.",
      );
    }

    // Global metrics schedule (sp_address = '')
    await this.jobScheduleRepository.upsertSchedule("metrics", "", metricsIntervalSeconds, metricsStartAt);
    await this.jobScheduleRepository.upsertSchedule(
      "metrics_cleanup",
      "",
      metricsCleanupIntervalSeconds,
      metricsStartAt,
    );
    await this.jobScheduleRepository.upsertSchedule(
      "providers_refresh",
      "",
      providersRefreshIntervalSeconds,
      providersRefreshStartAt,
    );
  }

  /**
   * Queries the DB for jobs that are due (`next_run_at <= now`).
   * Enqueues them into pg-boss, respecting rate limits.
   * Updates the `next_run_at` in the DB upon successful enqueue.
   */
  private getScheduleTiming(
    row: ScheduleRow,
    now: Date,
  ): {
    intervalMs: number;
    nextRunAt: Date;
    runsDue: number;
  } | null {
    const intervalMs = row.interval_seconds * 1000;
    if (intervalMs <= 0) return null;

    const nextRunAt = new Date(row.next_run_at);
    const diffMs = now.getTime() - nextRunAt.getTime();
    if (diffMs < 0) return null;

    const runsDue = Math.floor(diffMs / intervalMs) + 1;
    if (runsDue <= 0) return null;

    return { intervalMs, nextRunAt, runsDue };
  }

  private async enqueueDueJobs(): Promise<void> {
    if (!this.boss) return;

    const now = new Date();
    const maintenance = this.getMaintenanceWindowStatus(now);
    const catchupMax = this.catchupMaxEnqueue();

    if (maintenance.active) {
      this.logMaintenanceSkip("deal/retrieval enqueues", maintenance.window?.label);
    }

    await this.jobScheduleRepository.runTransaction(async (manager) => {
      const rows = await this.jobScheduleRepository.findDueSchedulesWithManager(manager, now);

      for (const row of rows) {
        const timing = this.getScheduleTiming(row, now);
        if (!timing) continue;
        const { intervalMs, nextRunAt, runsDue } = timing;

        const totalToEnqueue = Math.min(runsDue, catchupMax);
        let successCount = 0;
        const jobName = this.mapJobName(row.job_type);
        const payload = this.mapJobPayload(row);

        for (let i = 0; i < totalToEnqueue; i += 1) {
          if (await this.safeSend(row.job_type, jobName, payload)) {
            successCount += 1;
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
        return SP_WORK_QUEUE;
      case "retrieval":
        return SP_WORK_QUEUE;
      case "metrics":
        return METRICS_QUEUE;
      case "metrics_cleanup":
        return METRICS_CLEANUP_QUEUE;
      case "providers_refresh":
        return PROVIDERS_REFRESH_QUEUE;
      default: {
        const exhaustiveCheck: never = jobType;
        throw new Error(`Unhandled job type: ${exhaustiveCheck}`);
      }
    }
  }

  private mapJobPayload(row: ScheduleRow): SpJobData | MetricsJobData | ProvidersRefreshJobData {
    if (row.job_type === "deal" || row.job_type === "retrieval") {
      return { jobType: row.job_type, spAddress: row.sp_address, intervalSeconds: row.interval_seconds };
    }
    return { intervalSeconds: row.interval_seconds };
  }

  /**
   * Publishes a job to pg-boss and tracks enqueue attempts.
   */
  private async safeSend(
    jobType: JobType,
    name: string,
    data: SpJobData | MetricsJobData | ProvidersRefreshJobData,
    options?: SendOptions,
  ) {
    if (!this.boss) return false;
    try {
      // Disable retries so "attempted" jobs don't rerun; failures are handled by the next schedule tick.
      const finalOptions: SendOptions = { retryLimit: 0, ...options };
      if (jobType === "deal" || jobType === "retrieval") {
        const spData = data as SpJobData;
        if (!finalOptions.singletonKey) {
          finalOptions.singletonKey = spData.spAddress;
        }
      }
      await this.boss.send(name, data, finalOptions);
      this.jobsEnqueueAttemptsCounter.inc({ job_type: jobType, outcome: "success" });
      return true;
    } catch (error) {
      this.logger.warn(`Failed to enqueue ${name}: ${error.message}`);
      this.jobsEnqueueAttemptsCounter.inc({ job_type: jobType, outcome: "error" });
      return false;
    }
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
    const jobTypes: JobType[] = ["deal", "retrieval", "metrics", "metrics_cleanup", "providers_refresh"];
    for (const jobType of jobTypes) {
      this.jobsQueuedGauge.set({ job_type: jobType }, 0);
      this.jobsRetryScheduledGauge.set({ job_type: jobType }, 0);
      this.jobsInFlightGauge.set({ job_type: jobType }, 0);
      this.jobsPausedGauge.set({ job_type: jobType }, 0);
      this.oldestQueuedAgeGauge.set({ job_type: jobType }, 0);
      this.oldestInFlightAgeGauge.set({ job_type: jobType }, 0);
    }

    const rows = await this.jobScheduleRepository.countBossJobStates(["created", "retry", "active"]);
    if (rows.length > 0) {
      for (const row of rows) {
        const jobType = row.job_type as JobType;
        if (!jobTypes.includes(jobType)) continue;
        const state = String(row.state).toLowerCase();
        if (state === "active") {
          this.jobsInFlightGauge.set({ job_type: jobType }, row.count);
        } else if (state === "retry") {
          this.jobsRetryScheduledGauge.set({ job_type: jobType }, row.count);
        } else {
          this.jobsQueuedGauge.set({ job_type: jobType }, row.count);
        }
      }
    } else {
      this.logger.error(
        "pgboss.job returned zero rows for states created/retry/active; metrics will remain at 0. Verify the backend is connected to the expected database and schema.",
      );
    }

    const pausedSchedules = await this.jobScheduleRepository.countPausedSchedules();
    for (const row of pausedSchedules) {
      this.jobsPausedGauge.set({ job_type: row.job_type }, row.count);
    }

    const now = new Date();
    const queuedAges = await this.jobScheduleRepository.minBossJobAgeSecondsByState("created", now);
    for (const row of queuedAges) {
      const jobType = row.job_type as JobType;
      if (!jobTypes.includes(jobType)) continue;
      this.oldestQueuedAgeGauge.set({ job_type: jobType }, Math.max(0, row.min_age_seconds ?? 0));
    }

    const activeAges = await this.jobScheduleRepository.minBossJobAgeSecondsByState("active", now);
    for (const row of activeAges) {
      const jobType = row.job_type as JobType;
      if (!jobTypes.includes(jobType)) continue;
      this.oldestInFlightAgeGauge.set({ job_type: jobType }, Math.max(0, row.min_age_seconds ?? 0));
    }
  }
}
