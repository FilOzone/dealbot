import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import { type Job, PgBoss, type SendOptions } from "pg-boss";
import type { Counter, Gauge, Histogram } from "prom-client";
import type { Repository } from "typeorm";
import { DealJobTerminatedDataSetError } from "../common/errors.js";
import { type JobLogContext, type ProviderJobContext, toStructuredError } from "../common/logging.js";
import { getMaintenanceWindowStatus } from "../common/maintenance-window.js";
import { isSpBlocked } from "../common/sp-blocklist.js";
import type { Network } from "../common/types.js";
import type { IConfig } from "../config/index.js";
import { DataRetentionService } from "../data-retention/data-retention.service.js";
import type { JobType } from "../database/entities/job-schedule-state.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { DealService } from "../deal/deal.service.js";
import { PieceCleanupService } from "../piece-cleanup/piece-cleanup.service.js";
import { PullCheckService } from "../pull-check/pull-check.service.js";
import { RetrievalService } from "../retrieval/retrieval.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { provisionNextMissingDataSet } from "./data-set-creation.handler.js";
import {
  DATA_RETENTION_POLL_QUEUE,
  PROVIDERS_REFRESH_QUEUE,
  PULL_PIECE_CLEANUP_QUEUE,
  SP_WORK_QUEUE,
} from "./job-queues.js";
import { JobScheduleRepository } from "./repositories/job-schedule.repository.js";

type SpJobType = "deal" | "retrieval" | "data_set_creation" | "piece_cleanup" | "pull_check";
const SP_JOB_TYPES: ReadonlySet<string> = new Set<string>([
  "deal",
  "retrieval",
  "data_set_creation",
  "piece_cleanup",
  "pull_check",
]);
function isSpJobType(jobType: string): jobType is SpJobType {
  return SP_JOB_TYPES.has(jobType);
}

type SpJobData = { jobType: SpJobType; spAddress: string; network: Network; intervalSeconds: number };
type ProvidersRefreshJobData = { network: Network; intervalSeconds: number };
type SpJob = Job<SpJobData>;
type DataRetentionJobData = { network: Network; intervalSeconds: number };
type PullPieceCleanupJobData = { network: Network; intervalSeconds: number };

type ScheduleRow = {
  id: number;
  job_type: JobType;
  sp_address: string;
  network: Network;
  interval_seconds: number;
  next_run_at: string;
};

type JobRunStatus = "success" | "error" | "aborted";

@Injectable()
export class JobsService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(JobsService.name);
  private boss: PgBoss | null = null;
  private bossStartFailure?: unknown;
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
    private readonly walletSdkService: WalletSdkService,
    private readonly dataRetentionService: DataRetentionService,
    private readonly pieceCleanupService: PieceCleanupService,
    private readonly pullCheckService: PullCheckService,
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
    @InjectMetric("storage_providers_active")
    private readonly storageProvidersActive: Gauge,
    @InjectMetric("storage_providers_tested")
    private readonly storageProvidersTested: Gauge,
  ) {}

  /**
   * Initializes the scheduler.
   * If pg-boss mode is enabled, it ensures wallets are ready (unless chain disabled),
   * starts pg-boss, registers workers, and starts the scheduler polling loop.
   */
  async onModuleInit(): Promise<void> {
    if (!this.isPgbossEnabled()) {
      return;
    }

    this.logger.log({
      event: "pgboss_initialization",
      message: "Starting pg-boss initialization",
    });
    const runMode = this.configService.get("app")?.runMode ?? "both";
    const schedulerEnabled = runMode !== "worker" && (this.configService.get("jobs")?.pgbossSchedulerEnabled ?? true);
    const workersEnabled = runMode !== "api";

    if (process.env.DEALBOT_DISABLE_CHAIN !== "true") {
      const activeNetworks = this.configService.get("activeNetworks", { infer: true });
      for (const network of activeNetworks) {
        await this.walletSdkService.ensureWalletAllowances(network);
        await this.walletSdkService.ensureProvidersLoaded(network);
      }
    }
    await this.startBoss();
    if (!this.boss) {
      this.logger.error({
        event: "pgboss_start_unavailable",
        message: "pg-boss failed to start; job scheduler is disabled.",
      });
      if (workersEnabled || schedulerEnabled) {
        const startupError = this.bossStartFailure === undefined ? undefined : toStructuredError(this.bossStartFailure);
        this.logger.fatal({
          event: "pgboss_required_for_run_mode",
          message: "pg-boss is required for this run mode; failing startup.",
          runMode,
          error: startupError,
        });
        const reason =
          this.bossStartFailure instanceof Error && this.bossStartFailure.message.length > 0
            ? this.bossStartFailure.message
            : "unknown pg-boss startup failure";
        throw new Error(`pg-boss is required for run mode "${runMode}" but failed to start: ${reason}`);
      }
      return;
    }
    if (workersEnabled) {
      this.registerWorkers();
    } else {
      this.logger.warn({
        event: "pgboss_workers_disabled",
        message: "pg-boss workers disabled; run mode is api.",
      });
    }

    if (!schedulerEnabled) {
      this.logger.warn({
        event: "pgboss_scheduler_disabled",
        message: "pg-boss scheduler disabled; no enqueue loop will run.",
      });
      if (!workersEnabled) {
        this.logger.warn({
          event: "pgboss_workers_disabled",
          message: "pg-boss workers disabled; no jobs will be processed.",
        });
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
      /**
       * pg-boss `stop()` default timeout is 30s, shorter than any of our per-job timeouts.
       * Pass an explicit timeout that exceeds the longest job timeout so active handlers
       * can finish (or hit their per-job AbortController) before pg-boss force-fails
       * them via `failWip()`.
       */
      const activeNetworks = this.configService.get("activeNetworks", { infer: true });
      const networksConfig = this.configService.get("networks", { infer: true });

      let longestJobTimeoutSec = 0;

      for (const network of activeNetworks) {
        const cfg = networksConfig[network];

        const maxNetworkTimeout = Math.max(
          cfg.dealJobTimeoutSeconds,
          cfg.retrievalJobTimeoutSeconds,
          cfg.dataSetCreationJobTimeoutSeconds,
          cfg.pullCheckJobTimeoutSeconds,
        );

        if (maxNetworkTimeout > longestJobTimeoutSec) {
          longestJobTimeoutSec = maxNetworkTimeout;
        }
      }

      const stopTimeoutMs = (longestJobTimeoutSec + 60) * 1000;
      await this.boss.stop({ graceful: true, timeout: stopTimeoutMs });
      this.boss = null;

      /**
       * Hold the process alive past one ServiceMonitor scrape interval so
       * Prometheus captures the terminal counter increments emitted during drain.
       * Without this delay, the pod exits before its next scrape and the in-memory
       * counter deltas die with it, leaving `pending` rows without matching terminals.
       */
      const { shutdownFinalScrapeDelaySeconds } = this.configService.get("jobs", {
        infer: true,
      });
      const finalScrapeDelayMs = shutdownFinalScrapeDelaySeconds * 1000;
      if (finalScrapeDelayMs > 0) {
        this.logger.log({
          event: "pgboss_post_drain_scrape_hold",
          message: "Holding process for final Prometheus scrape after drain",
          delaySeconds: shutdownFinalScrapeDelaySeconds,
        });
        await new Promise((resolve) => setTimeout(resolve, finalScrapeDelayMs));
      }
    }
  }

  private isPgbossEnabled(): boolean {
    const runMode = this.configService.get("app")?.runMode ?? "both";
    const pgbossSchedulerEnabled = this.configService.get("jobs")?.pgbossSchedulerEnabled ?? true;

    const workersEnabled = runMode === "worker" || runMode === "both";
    const schedulerEnabled = (runMode === "api" || runMode === "both") && pgbossSchedulerEnabled;

    return workersEnabled || schedulerEnabled;
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
    this.bossStartFailure = undefined;
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
      this.logger.error({
        event: "pgboss_error",
        message: "pg-boss error",
        error: toStructuredError(error),
      });
    };
    boss.on("error", this.bossErrorHandler);
    try {
      await boss.start();
      await this.ensureWorkerQueues(boss);
      this.boss = boss;
    } catch (error) {
      this.bossStartFailure = error;
      boss.off("error", this.bossErrorHandler);
      this.bossErrorHandler = undefined;
      this.logger.error({
        event: "pgboss_start_failed",
        message: "Failed to start pg-boss",
        error: toStructuredError(error),
      });
    }
  }

  private async ensureWorkerQueues(boss: Pick<PgBoss, "createQueue">): Promise<void> {
    await boss.createQueue(SP_WORK_QUEUE, { policy: "singleton" });
    await boss.createQueue(PROVIDERS_REFRESH_QUEUE);
    await boss.createQueue(DATA_RETENTION_POLL_QUEUE);
    await boss.createQueue(PULL_PIECE_CLEANUP_QUEUE);
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
          if (job.data.jobType === "data_set_creation") {
            await this.handleDataSetCreationJob(job);
            return;
          }
          if (job.data.jobType === "piece_cleanup") {
            await this.handlePieceCleanupJob(job);
            return;
          }
          if (job.data.jobType === "pull_check") {
            await this.handlePullCheckJob(job);
            return;
          }
          this.logger.warn({
            event: "unknown_sp_job_type",
            message: "Skipping unknown SP job type",
            jobType: job.data.jobType,
            providerAddress: job.data.spAddress,
            providerId: this.walletSdkService.getProviderInfo(job.data.spAddress, job.data.network)?.id,
            providerName: this.walletSdkService.getProviderInfo(job.data.spAddress, job.data.network)?.name,
          });
        },
      )
      .catch((error) =>
        this.logger.error({
          event: "worker_register_failed",
          message: "Failed to register worker",
          queue: SP_WORK_QUEUE,
          error: toStructuredError(error),
        }),
      );
    void this.boss
      .work<DataRetentionJobData, void>(
        DATA_RETENTION_POLL_QUEUE,
        { batchSize: 1, pollingIntervalSeconds: workerPollSeconds },
        async ([job]) => this.handleDataRetentionJob(job.data),
      )
      .catch((error) =>
        this.logger.error({
          event: "worker_register_failed",
          message: "Failed to register worker",
          queue: DATA_RETENTION_POLL_QUEUE,
          error: toStructuredError(error),
        }),
      );
    void this.boss
      .work(PROVIDERS_REFRESH_QUEUE, { batchSize: 1, pollingIntervalSeconds: workerPollSeconds }, async ([job]) =>
        this.handleProvidersRefreshJob(job.data as ProvidersRefreshJobData),
      )
      .catch((error) =>
        this.logger.error({
          event: "worker_register_failed",
          message: "Failed to register worker",
          queue: PROVIDERS_REFRESH_QUEUE,
          error: toStructuredError(error),
        }),
      );
    void this.boss
      .work<PullPieceCleanupJobData, void>(
        PULL_PIECE_CLEANUP_QUEUE,
        { batchSize: 1, pollingIntervalSeconds: workerPollSeconds },
        async ([job]) => this.handlePullPieceCleanupJob(job.data),
      )
      .catch((error) =>
        this.logger.error({
          event: "worker_register_failed",
          message: "Failed to register worker",
          queue: PULL_PIECE_CLEANUP_QUEUE,
          error: toStructuredError(error),
        }),
      );
  }

  private getMaintenanceWindowStatus(now: Date = new Date(), network: Network) {
    const networkConfig = this.configService.get("networks", { infer: true })[network];
    return getMaintenanceWindowStatus(now, networkConfig.maintenanceWindowsUtc, networkConfig.maintenanceWindowMinutes);
  }

  private async resolveProviderJobContext(
    spAddress: string,
    jobId: string,
    network: Network,
  ): Promise<ProviderJobContext> {
    let providerInfo = this.walletSdkService.getProviderInfo(spAddress, network);

    if (providerInfo == null && process.env.DEALBOT_DISABLE_CHAIN !== "true") {
      await this.walletSdkService.loadProviders(network);
      providerInfo = this.walletSdkService.getProviderInfo(spAddress, network);
    }

    let providerId = providerInfo?.id;
    let providerName = providerInfo?.name;

    // Fall back to DB if either providerId or providerName is missing
    if (providerId == null || !providerName) {
      const provider = await this.storageProviderRepository.findOne({
        where: { address: spAddress, network },
        select: { providerId: true, name: true },
      });
      providerId = providerId ?? provider?.providerId ?? undefined;
      providerName = providerName || provider?.name;
    }

    if (providerId == null) {
      throw new Error(`providerId is required for job execution but missing for provider ${spAddress}`);
    }

    if (!providerName) {
      throw new Error(`providerName is required for job execution but missing for provider ${spAddress}`);
    }

    return {
      jobId,
      providerAddress: spAddress,
      providerId,
      providerName,
      network,
    };
  }

  private async resolveRunnableProviderJobContext(
    jobType: SpJobType,
    spAddress: string,
    jobId: string,
    message: string,
    network: Network,
  ): Promise<ProviderJobContext | null> {
    const networkCfg = this.configService.get("networks", { infer: true })[network];
    if (isSpBlocked(networkCfg, spAddress)) {
      this.logger.log({
        jobId,
        providerAddress: spAddress,
        event: `${jobType}_job_blocked`,
        message,
      });
      return null;
    }

    const logContext = await this.resolveProviderJobContext(spAddress, jobId, network);
    if (isSpBlocked(networkCfg, spAddress, logContext.providerId)) {
      this.logger.log({
        ...logContext,
        event: `${jobType}_job_blocked`,
        message,
      });
      return null;
    }

    return logContext;
  }

  private logMaintenanceSkip(
    taskLabel: string,
    network: Network,
    windowLabel?: string,
    logContext?: Partial<JobLogContext>,
  ) {
    const networkCfg = this.configService.get("networks", { infer: true })[network];
    const label = windowLabel ?? "unknown";
    this.logger.log({
      ...logContext,
      event: "maintenance_window_active",
      message: `Maintenance window active (${label} UTC, ${networkCfg.maintenanceWindowMinutes}m); deferring ${taskLabel}`,
    });
  }

  private async handleDealJob(job: SpJob): Promise<void> {
    const data = job.data;
    const { spAddress, network } = data;
    const now = new Date();
    const maintenance = this.getMaintenanceWindowStatus(now, network);
    if (maintenance.active) {
      this.logMaintenanceSkip(`deal job for ${spAddress}`, network, maintenance.window?.label, {
        jobId: job.id,
        providerAddress: spAddress,
        providerId: this.walletSdkService.getProviderInfo(spAddress, network)?.id,
        providerName: this.walletSdkService.getProviderInfo(spAddress, network)?.name,
      });
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

    await this.recordJobExecution("deal", network, async () => {
      const logContext = await this.resolveRunnableProviderJobContext(
        "deal",
        spAddress,
        job.id,
        "Deal job skipped: provider is blocked for scheduled data-storage checks",
        network,
      );
      if (logContext == null) {
        clearTimeout(timeoutId);
        return "success";
      }
      try {
        let provider = this.walletSdkService.getTestingProviders(network).find((p) => p.serviceProvider === spAddress);
        if (!provider) {
          if (process.env.DEALBOT_DISABLE_CHAIN !== "true") {
            await this.walletSdkService.loadProviders(network);
          }
          provider = this.walletSdkService.getTestingProviders(network).find((p) => p.serviceProvider === spAddress);
          if (!provider) {
            this.logger.warn({
              ...logContext,
              event: "deal_job_skipped",
              message: "Deal job skipped: provider not found",
            });
            return "success";
          }
        }

        abortController.signal.throwIfAborted();
        await this.dealService.createDealForProvider(provider, {
          network,
          signal: abortController.signal,
          logContext: {
            network,
            jobId: logContext.jobId,
            providerAddress: logContext.providerAddress,
            providerId: provider.id ?? logContext.providerId,
            providerName: provider.name ?? logContext.providerName,
          },
        });
        return "success";
      } catch (error) {
        if (abortController.signal.aborted) {
          const reason = abortController.signal.reason;
          const reasonMessage = reason instanceof Error ? reason.message : String(reason ?? "");
          this.logger.error({
            ...logContext,
            event: "deal_job_aborted",
            message: reasonMessage || "Deal job aborted after timeout",
            timeoutSeconds: effectiveTimeoutSeconds,
            error: toStructuredError(reason ?? error),
          });
          return "aborted";
        }
        if (error instanceof DealJobTerminatedDataSetError) {
          this.logger.error({
            ...logContext,
            event: "deal_job_failed_terminated_dataset",
            message: "Deal job failed: data set is PDP-terminated; awaiting data_set_creation repair",
            dataSetId: error.dataSetId.toString(),
          });
          return "error";
        }
        this.logger.error({
          ...logContext,
          event: "deal_job_failed",
          message: "Deal job failed",
          error: toStructuredError(error),
        });
        // Jobs are not retried once attempted; failures are handled by the next schedule tick.
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    });
  }

  private async handleRetrievalJob(job: SpJob): Promise<void> {
    const data = job.data;
    const { spAddress, network } = data;
    const now = new Date();
    const maintenance = this.getMaintenanceWindowStatus(now, network);
    if (maintenance.active) {
      this.logMaintenanceSkip(`retrieval job for ${spAddress}`, network, maintenance.window?.label, {
        jobId: job.id,
        providerAddress: spAddress,
        providerId: this.walletSdkService.getProviderInfo(spAddress, network)?.id,
        providerName: this.walletSdkService.getProviderInfo(spAddress, network)?.name,
      });
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

    await this.recordJobExecution("retrieval", network, async () => {
      const logContext = await this.resolveRunnableProviderJobContext(
        "retrieval",
        spAddress,
        job.id,
        "Retrieval job skipped: provider is blocked for scheduled retrieval checks",
        network,
      );
      if (logContext == null) {
        clearTimeout(timeoutId);
        return "success";
      }
      try {
        await this.retrievalService.performRandomRetrievalForProvider(
          spAddress,
          network,
          abortController.signal,
          logContext,
        );
        return "success";
      } catch (error) {
        if (abortController.signal.aborted) {
          const reason = abortController.signal.reason;
          const reasonMessage = reason instanceof Error ? reason.message : String(reason ?? "");
          this.logger.error({
            ...logContext,
            event: "retrieval_job_aborted",
            message: reasonMessage || "Retrieval job aborted after timeout",
            timeoutSeconds: effectiveTimeoutSeconds,
            error: toStructuredError(reason ?? error),
          });
          return "aborted";
        }
        this.logger.error({
          ...logContext,
          event: "retrieval_job_failed",
          message: "Retrieval job failed",
          error: toStructuredError(error),
        });
        // Jobs are not retried once attempted; failures are handled by the next schedule tick.
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    });
  }

  private async handleDataRetentionJob(data: DataRetentionJobData): Promise<void> {
    await this.recordJobExecution("data_retention_poll", data.network, async () => {
      await this.dataRetentionService.pollDataRetention(data.network);
      return "success";
    });
  }

  private async handleProvidersRefreshJob(data: ProvidersRefreshJobData): Promise<void> {
    await this.recordJobExecution("providers_refresh", data.network, async () => {
      if (process.env.DEALBOT_DISABLE_CHAIN === "true") {
        this.logger.warn({
          event: "chain_integration_disabled",
          message: "Chain integration disabled; skipping provider refresh job.",
          network: data.network,
        });
      } else {
        await this.walletSdkService.loadProviders(data.network);
      }
      await this.updateStorageProviderGauges(data.network);
      return "success";
    });
  }

  private async handlePullPieceCleanupJob(data: PullPieceCleanupJobData): Promise<void> {
    void data;
    await this.recordJobExecution("pull_piece_cleanup", data.network, async () => {
      const deletedCount = await this.pullCheckService.deleteExpiredPullPieces();
      this.logger.log({
        event: "pull_piece_cleanup_completed",
        message: "Deleted expired pull piece registrations",
        deletedCount,
        network: data.network,
      });
      return "success";
    });
  }

  private async handlePullCheckJob(job: SpJob): Promise<void> {
    const data = job.data;
    const { spAddress, network } = data;
    const now = new Date();
    const maintenance = this.getMaintenanceWindowStatus(now, network);
    if (maintenance.active) {
      this.logMaintenanceSkip(`pull_check job for ${spAddress}`, network, maintenance.window?.label, {
        jobId: job.id,
        providerAddress: spAddress,
        providerId: this.walletSdkService.getProviderInfo(spAddress, network)?.id,
        providerName: this.walletSdkService.getProviderInfo(spAddress, network)?.name,
      });
      await this.deferJobForMaintenance("pull_check", data, maintenance, now);
      return;
    }

    const abortController = new AbortController();
    const timeoutSeconds = this.configService.get("networks", { infer: true })[network].pullCheckJobTimeoutSeconds;
    const timeoutMs = Math.max(60000, timeoutSeconds * 1000);
    const effectiveTimeoutSeconds = Math.round(timeoutMs / 1000);
    const abortReason = new Error(`Pull check job timeout (${effectiveTimeoutSeconds}s) for ${spAddress}`);
    const timeoutId = setTimeout(() => {
      abortController.abort(abortReason);
    }, timeoutMs);

    await this.recordJobExecution("pull_check", network, async () => {
      const logContext = await this.resolveRunnableProviderJobContext(
        "pull_check",
        spAddress,
        job.id,
        "Pull check job skipped: provider is blocked for scheduled pull checks",
        network,
      );
      if (logContext == null) {
        clearTimeout(timeoutId);
        return "success";
      }
      try {
        await this.pullCheckService.runPullCheck(spAddress, abortController.signal, logContext);
        return "success";
      } catch (error) {
        if (abortController.signal.aborted) {
          const reason = abortController.signal.reason;
          const reasonMessage = reason instanceof Error ? reason.message : String(reason ?? "");
          this.logger.error({
            ...logContext,
            event: "pull_check_job_aborted",
            message: reasonMessage || "Pull check job aborted after timeout",
            timeoutSeconds: effectiveTimeoutSeconds,
            error: toStructuredError(reason ?? error),
          });
          return "aborted";
        }
        this.logger.error({
          ...logContext,
          event: "pull_check_job_failed",
          message: "Pull check job failed",
          error: toStructuredError(error),
        });
        // Jobs are not retried once attempted; failures are handled by the next schedule tick.
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    });
  }

  private async handlePieceCleanupJob(job: SpJob): Promise<void> {
    const data = job.data;
    const { spAddress, network } = data;
    const now = new Date();
    const maintenance = this.getMaintenanceWindowStatus(now, network);
    if (maintenance.active) {
      this.logMaintenanceSkip(`piece_cleanup job for ${spAddress}`, network, maintenance.window?.label, {
        jobId: job.id,
        providerAddress: spAddress,
        providerId: this.walletSdkService.getProviderInfo(spAddress, network)?.id,
      });
      await this.deferJobForMaintenance("piece_cleanup", data, maintenance, now);
      return;
    }

    const abortController = new AbortController();
    const jobsConfig = this.configService.get("jobs");
    const timeoutSeconds = jobsConfig.maxPieceCleanupRuntimeSeconds;
    const timeoutMs = Math.max(60000, timeoutSeconds * 1000);
    const effectiveTimeoutSeconds = Math.round(timeoutMs / 1000);
    const abortReason = new Error(`Piece cleanup job timeout (${effectiveTimeoutSeconds}s) for ${spAddress}`);
    const timeoutId = setTimeout(() => {
      abortController.abort(abortReason);
    }, timeoutMs);

    await this.recordJobExecution("piece_cleanup", network, async () => {
      const logContext = await this.resolveProviderJobContext(spAddress, job.id, network);
      try {
        await this.pieceCleanupService.cleanupPiecesForProvider(spAddress, network, abortController.signal, logContext);
        return "success";
      } catch (error) {
        if (abortController.signal.aborted) {
          const reason = abortController.signal.reason;
          const reasonMessage = reason instanceof Error ? reason.message : String(reason ?? "");
          this.logger.warn({
            ...logContext,
            event: "piece_cleanup_job_aborted",
            message: reasonMessage || "Piece cleanup job aborted",
            timeoutSeconds: effectiveTimeoutSeconds,
            error: toStructuredError(reason ?? error),
          });
          return "aborted";
        }
        this.logger.error({
          ...logContext,
          event: "piece_cleanup_job_failed",
          message: "Piece cleanup job failed",
          error: toStructuredError(error),
        });
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    });
  }

  private async updateStorageProviderGauges(network: Network): Promise<void> {
    try {
      const networkFilter = { network };
      const totalProviders = await this.storageProviderRepository.count({ where: networkFilter });
      const activeCount = await this.storageProviderRepository.count({ where: { ...networkFilter, isActive: true } });
      const inactiveCount = Math.max(0, totalProviders - activeCount);

      this.storageProvidersActive.set({ status: "active", network }, activeCount);
      this.storageProvidersActive.set({ status: "inactive", network }, inactiveCount);

      const networkCfg = this.configService.get("networks", { infer: true })[network];

      const testedWhere = networkCfg.useOnlyApprovedProviders
        ? { network, isActive: true, isApproved: true }
        : { network, isActive: true };
      const hasGlobalBlocklist = networkCfg.blockedSpIds.size > 0 || networkCfg.blockedSpAddresses.size > 0;
      let testedCount: number;
      if (hasGlobalBlocklist) {
        const testedProviders = await this.storageProviderRepository.find({
          select: { address: true, providerId: true },
          where: testedWhere,
        });
        testedCount = testedProviders.filter((p) => !isSpBlocked(networkCfg, p.address, p.providerId)).length;
      } else {
        testedCount = await this.storageProviderRepository.count({ where: testedWhere });
      }

      this.storageProvidersTested.set({ network }, testedCount);
    } catch (error) {
      this.logger.warn({
        event: "update_storage_provider_metrics_failed",
        message: "Failed to update storage provider metrics",
        error: toStructuredError(error),
      });
    }
  }

  private async handleDataSetCreationJob(job: SpJob): Promise<void> {
    const data = job.data;
    const { spAddress, network } = data;
    const now = new Date();
    const maintenance = this.getMaintenanceWindowStatus(now, network);
    if (maintenance.active) {
      this.logMaintenanceSkip(`data_set_creation job for ${spAddress}`, network, maintenance.window?.label, {
        jobId: job.id,
        providerAddress: spAddress,
        providerId: this.walletSdkService.getProviderInfo(spAddress, network)?.id,
        providerName: this.walletSdkService.getProviderInfo(spAddress, network)?.name,
      });
      await this.deferJobForMaintenance("data_set_creation", data, maintenance, now);
      return;
    }

    const minDataSets = this.configService.get("networks", { infer: true })[network].minNumDataSetsForChecks;
    const baseDataSetMetadata = this.dealService.getBaseDataSetMetadata(network);

    // Create AbortController for job timeout enforcement
    const abortController = new AbortController();
    const timeoutSeconds = this.configService.get("jobs").dataSetCreationJobTimeoutSeconds;
    const timeoutMs = Math.max(120000, timeoutSeconds * 1000);
    const effectiveTimeoutSeconds = Math.round(timeoutMs / 1000);
    const abortReason = new Error(`Data set creation job timeout (${effectiveTimeoutSeconds}s) for ${spAddress}`);
    const timeoutId = setTimeout(() => {
      abortController.abort(abortReason);
    }, timeoutMs);

    await this.recordJobExecution("data_set_creation", network, async () => {
      const dataSetLogContext = await this.resolveRunnableProviderJobContext(
        "data_set_creation",
        spAddress,
        job.id,
        "Data set creation job skipped: provider is blocked for scheduled data-storage checks",
        network,
      );
      if (dataSetLogContext == null) {
        clearTimeout(timeoutId);
        return "success";
      }
      try {
        await provisionNextMissingDataSet(
          { dealService: this.dealService, logger: this.logger },
          spAddress,
          network,
          minDataSets,
          baseDataSetMetadata,
          dataSetLogContext,
          abortController.signal,
        );
        return "success";
      } catch (error) {
        if (abortController.signal.aborted) {
          const reason = abortController.signal.reason;
          const reasonMessage = reason instanceof Error ? reason.message : String(reason ?? "");
          this.logger.error({
            ...dataSetLogContext,
            event: "data_set_creation_job_aborted",
            message: reasonMessage || "Data set creation job aborted after timeout",
            timeoutSeconds: effectiveTimeoutSeconds,
            error: toStructuredError(reason ?? error),
          });
          return "aborted";
        }
        this.logger.error({
          ...dataSetLogContext,
          event: "data_set_creation_job_failed",
          message: "Data set creation job failed",
          error: toStructuredError(error),
        });
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    });
  }

  private maintenanceResumeAt(
    now: Date,
    network: Network,
    maintenance: ReturnType<typeof getMaintenanceWindowStatus>,
  ): Date | null {
    if (!maintenance.active || !maintenance.window) {
      return null;
    }
    const networkConfig = this.configService.get("networks", { infer: true })[network];
    const durationMinutes = networkConfig.maintenanceWindowMinutes;
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
    const resumeAt = this.maintenanceResumeAt(now, data.network, maintenance);
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
      this.logger.warn({
        event: "pgboss_scheduler_tick_skipped",
        message: "Previous pg-boss scheduler tick still running; skipping",
      });
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
    const activeNetworks = this.configService.get<Network[]>("activeNetworks");
    for (const network of activeNetworks) {
      try {
        await this.ensureScheduleRows(network);
        await this.enqueueDueJobs(network);
      } catch (error) {
        this.logger.error({
          event: "pgboss_scheduler_tick_failed",
          message: "pg-boss scheduler core tick failed",
          error: toStructuredError(error),
        });
      }

      try {
        await this.updateQueueMetrics(network);
      } catch (error) {
        this.logger.error({
          event: "pgboss_scheduler_metrics_update_failed",
          message: "pg-boss scheduler metrics update failed",
          error: toStructuredError(error),
        });
      }
    }
  }

  private getIntervalSecondsForRates(network: Network): {
    dealIntervalSeconds: number;
    retrievalIntervalSeconds: number;
    dataSetCreationIntervalSeconds: number;
    dataRetentionPollIntervalSeconds: number;
    providersRefreshIntervalSeconds: number;
    pieceCleanupIntervalSeconds: number;
    pullCheckIntervalSeconds: number;
    pullPieceCleanupIntervalSeconds: number;
  } {
    const networkCfg = this.configService.get("networks", { infer: true })[network];

    const {
      dealsPerSpPerHour,
      retrievalsPerSpPerHour,
      dataSetCreationsPerSpPerHour,
      pieceCleanupPerSpPerHour,
      pullChecksPerSpPerHour,
      dataRetentionPollIntervalSeconds,
      providersRefreshIntervalSeconds,
      pullPieceCleanupIntervalSeconds,
    } = networkCfg;

    const dealIntervalSeconds = Math.max(1, Math.round(3600 / dealsPerSpPerHour));
    const retrievalIntervalSeconds = Math.max(1, Math.round(3600 / retrievalsPerSpPerHour));
    const dataSetCreationIntervalSeconds = Math.max(1, Math.round(3600 / dataSetCreationsPerSpPerHour));
    const pieceCleanupIntervalSeconds = Math.max(1, Math.round(3600 / pieceCleanupPerSpPerHour));
    const pullCheckIntervalSeconds = Math.max(1, Math.round(3600 / pullChecksPerSpPerHour));

    return {
      dealIntervalSeconds,
      retrievalIntervalSeconds,
      dataSetCreationIntervalSeconds,
      dataRetentionPollIntervalSeconds,
      providersRefreshIntervalSeconds,
      pieceCleanupIntervalSeconds,
      pullCheckIntervalSeconds,
      pullPieceCleanupIntervalSeconds,
    };
  }

  /**
   * Syncs the "job_schedule_state" table with the current list of active providers.
   * - Inserts new rows for new providers.
   * - Updates intervals if config changed.
   * - Pauses rows for providers that are no longer active.
   * - Ensures global data_retention_poll, providers_refresh, and pull_piece_cleanup jobs exist.
   */
  private async ensureScheduleRows(network: Network): Promise<void> {
    const now = new Date();
    const {
      dealIntervalSeconds,
      retrievalIntervalSeconds,
      dataSetCreationIntervalSeconds,
      dataRetentionPollIntervalSeconds,
      providersRefreshIntervalSeconds,
      pieceCleanupIntervalSeconds,
      pullCheckIntervalSeconds,
      pullPieceCleanupIntervalSeconds,
    } = this.getIntervalSecondsForRates(network);

    const networkCfg = this.configService.get("networks")[network];
    const useOnlyApprovedProviders = networkCfg.useOnlyApprovedProviders;
    // Active providers are guaranteed to support ipniIpfs
    // as validated by WalletSdkService.loadProvidersInternal()
    const providers = await this.storageProviderRepository.find({
      select: { address: true, providerId: true },
      where: { network, isActive: true, ...(useOnlyApprovedProviders && { isApproved: true }) },
    });

    const phaseMs = this.schedulePhaseSeconds() * 1000;
    const dealStartAt = new Date(now.getTime() + phaseMs);
    const retrievalStartAt = new Date(now.getTime() + phaseMs);
    const dataSetCreationStartAt = new Date(now.getTime() + phaseMs);
    const dataRetentionPollStartAt = new Date(now.getTime() + phaseMs);
    const providersRefreshStartAt = new Date(now.getTime() + phaseMs);

    const minDataSets = networkCfg.minNumDataSetsForChecks;
    const cleanupStartAt = new Date(now.getTime() + phaseMs);
    const pullCheckStartAt = new Date(now.getTime() + phaseMs);

    const unblockedAddresses = providers
      .filter(({ address, providerId }) => !isSpBlocked(networkCfg, address, providerId))
      .map(({ address }) => address);
    const blockedCount = providers.length - unblockedAddresses.length;
    if (blockedCount > 0) {
      this.logger.warn({
        event: "job_schedules_skipped_blocked",
        message: "Skipping job schedule upsert for blocked providers",
        blockedCount,
      });
    }

    for (const address of unblockedAddresses) {
      await this.jobScheduleRepository.upsertSchedule("deal", address, network, dealIntervalSeconds, dealStartAt);
      await this.jobScheduleRepository.upsertSchedule(
        "retrieval",
        address,
        network,
        retrievalIntervalSeconds,
        retrievalStartAt,
      );
      if (minDataSets >= 1) {
        await this.jobScheduleRepository.upsertSchedule(
          "data_set_creation",
          address,
          network,
          dataSetCreationIntervalSeconds,
          dataSetCreationStartAt,
        );
      }
      await this.jobScheduleRepository.upsertSchedule(
        "piece_cleanup",
        address,
        network,
        pieceCleanupIntervalSeconds,
        cleanupStartAt,
      );
      await this.jobScheduleRepository.upsertSchedule(
        "pull_check",
        address,
        network,
        pullCheckIntervalSeconds,
        pullCheckStartAt,
      );
    }

    if (providers.length > 0) {
      const deletedAddresses = await this.jobScheduleRepository.deleteSchedulesForInactiveProviders(
        unblockedAddresses,
        network,
      );
      if (deletedAddresses.length > 0) {
        this.logger.warn({
          event: "job_schedules_deleted",
          message: "Deleted job schedules for providers no longer in active list",
          deletedCount: deletedAddresses.length,
          deletedAddresses,
        });
      }
    } else {
      this.logger.warn({
        event: "job_schedule_deletion_skipped",
        message: "No active providers found; skipping job schedule deletion to prevent accidental mass-deletion",
      });
    }

    // Per-network global job schedules (sp_address = '')
    await this.jobScheduleRepository.upsertSchedule(
      "data_retention_poll",
      "",
      network,
      dataRetentionPollIntervalSeconds,
      dataRetentionPollStartAt,
    );
    await this.jobScheduleRepository.upsertSchedule(
      "providers_refresh",
      "",
      network,
      providersRefreshIntervalSeconds,
      providersRefreshStartAt,
    );
    await this.jobScheduleRepository.upsertSchedule(
      "pull_piece_cleanup",
      "",
      network,
      pullPieceCleanupIntervalSeconds,
      new Date(now.getTime() + phaseMs),
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

  private async enqueueDueJobs(network: Network): Promise<void> {
    if (!this.boss) return;

    const now = new Date();
    const maintenance = this.getMaintenanceWindowStatus(now, network);
    const catchupMax = this.catchupMaxEnqueue();

    if (maintenance.active) {
      this.logMaintenanceSkip("Global job enqueues", network, maintenance.window?.label);
    }

    await this.jobScheduleRepository.runTransaction(async (manager) => {
      const rows = await this.jobScheduleRepository.findDueSchedulesWithManager(manager, now, network);

      for (const row of rows) {
        const timing = this.getScheduleTiming(row, now);
        if (!timing) continue;
        const { intervalMs, nextRunAt, runsDue } = timing;

        const isSpJob = isSpJobType(row.job_type);

        // During maintenance, skip global jobs entirely.
        if (maintenance.active && !isSpJob) {
          this.logger.log({
            event: "global_job_enqueue_skipped",
            message: "Skipping global job during maintenance",
            jobType: row.job_type,
            maintenanceWindow: maintenance.window?.label,
          });
          const newNextRunAt = new Date(now.getTime() + intervalMs);
          await this.jobScheduleRepository.advanceScheduleNextRun(manager, row.id, newNextRunAt);
          continue;
        }

        const totalToEnqueue = isSpJob ? Math.min(runsDue, catchupMax) : 1;
        let successCount = 0;
        const jobName = this.mapJobName(row.job_type);
        const payload = this.mapJobPayload(row);

        for (let i = 0; i < totalToEnqueue; i += 1) {
          if (await this.safeSend(row.job_type, jobName, payload)) {
            successCount += 1;
          }
        }

        if (successCount > 0) {
          // For global jobs, skip ahead to the next future run instead of replaying missed intervals.
          const newNextRunAt = isSpJob
            ? new Date(nextRunAt.getTime() + successCount * intervalMs)
            : new Date(now.getTime() + intervalMs);
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
      case "data_set_creation":
        return SP_WORK_QUEUE;
      case "piece_cleanup":
        return SP_WORK_QUEUE;
      case "pull_check":
        return SP_WORK_QUEUE;
      case "data_retention_poll":
        return DATA_RETENTION_POLL_QUEUE;
      case "providers_refresh":
        return PROVIDERS_REFRESH_QUEUE;
      case "pull_piece_cleanup":
        return PULL_PIECE_CLEANUP_QUEUE;
      default: {
        const exhaustiveCheck: never = jobType;
        throw new Error(`Unhandled job type: ${exhaustiveCheck}`);
      }
    }
  }

  private mapJobPayload(row: ScheduleRow): SpJobData | ProvidersRefreshJobData | DataRetentionJobData {
    if (
      row.job_type === "deal" ||
      row.job_type === "retrieval" ||
      row.job_type === "data_set_creation" ||
      row.job_type === "piece_cleanup" ||
      row.job_type === "pull_check"
    ) {
      return {
        jobType: row.job_type,
        spAddress: row.sp_address,
        network: row.network,
        intervalSeconds: row.interval_seconds,
      };
    }
    return { network: row.network, intervalSeconds: row.interval_seconds };
  }

  /**
   * Publishes a job to pg-boss and tracks enqueue attempts.
   */
  private async safeSend(
    jobType: JobType,
    name: string,
    data: SpJobData | ProvidersRefreshJobData | DataRetentionJobData,
    options?: SendOptions,
  ) {
    if (!this.boss) return false;
    try {
      // Disable retries so "attempted" jobs don't rerun; failures are handled by the next schedule tick.
      const finalOptions: SendOptions = { retryLimit: 0, ...options };
      if (isSpJobType(jobType)) {
        const spData = data as SpJobData;
        if (!finalOptions.singletonKey) {
          // Include network in singleton key to prevent cross-network deduplication collisions
          finalOptions.singletonKey = `${spData.network}:${spData.spAddress}`;
        }
      } else {
        // Global jobs: include network in singleton key for per-network isolation
        finalOptions.singletonKey = `${data.network}:${jobType}`;
      }
      await this.boss.send(name, data, finalOptions);
      this.jobsEnqueueAttemptsCounter.inc({ job_type: jobType, outcome: "success", network: data.network });
      return true;
    } catch (error) {
      this.logger.warn({
        event: "job_enqueue_failed",
        message: "Failed to enqueue job",
        queue: name,
        jobType,
        error: toStructuredError(error),
      });
      this.jobsEnqueueAttemptsCounter.inc({ job_type: jobType, outcome: "error", network: data.network });
      return false;
    }
  }

  /**
   * Records handler start/end metrics around a job execution.
   */
  private async recordJobExecution(
    jobType: JobType,
    network: Network,
    run: () => Promise<JobRunStatus>,
  ): Promise<void> {
    const startedAt = Date.now();
    this.jobsStartedCounter.inc({ job_type: jobType, network });
    try {
      const status = await run();
      const finishedAt = Date.now();
      this.jobDuration.observe({ job_type: jobType, network }, (finishedAt - startedAt) / 1000);
      this.jobsCompletedCounter.inc({ job_type: jobType, handler_result: status, network });
    } catch (error) {
      const finishedAt = Date.now();
      this.jobDuration.observe({ job_type: jobType, network }, (finishedAt - startedAt) / 1000);
      this.jobsCompletedCounter.inc({ job_type: jobType, handler_result: "error", network });
      throw error;
    }
  }

  /**
   * Refreshes queue depth and age gauges from pg-boss tables.
   */
  private async updateQueueMetrics(network: Network): Promise<void> {
    const jobTypes: JobType[] = [
      "deal",
      "retrieval",
      "data_set_creation",
      "piece_cleanup",
      "pull_check",
      "data_retention_poll",
      "providers_refresh",
      "pull_piece_cleanup",
    ];
    for (const jobType of jobTypes) {
      this.jobsQueuedGauge.set({ job_type: jobType, network }, 0);
      this.jobsRetryScheduledGauge.set({ job_type: jobType, network }, 0);
      this.jobsInFlightGauge.set({ job_type: jobType, network }, 0);
      this.jobsPausedGauge.set({ job_type: jobType, network }, 0);
      this.oldestQueuedAgeGauge.set({ job_type: jobType, network }, 0);
      this.oldestInFlightAgeGauge.set({ job_type: jobType, network }, 0);
    }

    const rows = await this.jobScheduleRepository.countBossJobStates(["created", "retry", "active"], network);
    if (rows.length > 0) {
      for (const row of rows) {
        const jobType = row.job_type as JobType;
        if (!jobTypes.includes(jobType)) continue;
        const state = String(row.state).toLowerCase();
        if (state === "active") {
          this.jobsInFlightGauge.set({ job_type: jobType, network }, row.count);
        } else if (state === "retry") {
          this.jobsRetryScheduledGauge.set({ job_type: jobType, network }, row.count);
        } else {
          this.jobsQueuedGauge.set({ job_type: jobType, network }, row.count);
        }
      }
    } else {
      this.logger.error({
        event: "pgboss_job_state_query_empty",
        message:
          "pgboss.job returned zero rows for states created/retry/active; metrics will remain at 0. Verify the backend is connected to the expected database and schema.",
      });
    }

    const pausedSchedules = await this.jobScheduleRepository.countPausedSchedules(network);
    for (const row of pausedSchedules) {
      this.jobsPausedGauge.set({ job_type: row.job_type, network }, row.count);
    }

    const now = new Date();
    const queuedAges = await this.jobScheduleRepository.minBossJobAgeSecondsByState("created", now, network);
    for (const row of queuedAges) {
      const jobType = row.job_type as JobType;
      if (!jobTypes.includes(jobType)) continue;
      this.oldestQueuedAgeGauge.set({ job_type: jobType, network }, Math.max(0, row.min_age_seconds ?? 0));
    }

    const activeAges = await this.jobScheduleRepository.minBossJobAgeSecondsByState("active", now, network);
    for (const row of activeAges) {
      const jobType = row.job_type as JobType;
      if (!jobTypes.includes(jobType)) continue;
      this.oldestInFlightAgeGauge.set({ job_type: jobType, network }, Math.max(0, row.min_age_seconds ?? 0));
    }
  }
}
