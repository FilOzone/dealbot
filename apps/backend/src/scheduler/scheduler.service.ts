import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { IConfig, ISchedulingConfig } from "../config/app.config.js";
import { DealService } from "../deal/deal.service.js";
import { RetrievalService } from "../retrieval/retrieval.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { DbAnchoredScheduler } from "./db-anchored-scheduler.js";

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly dbScheduler: DbAnchoredScheduler;
  private isRunningDealCreation = false;
  private isRunningRetrievalTests = false;
  private retrievalAbortController?: AbortController;
  private retrievalRunPromise?: Promise<void>;

  constructor(
    private dealService: DealService,
    private retrievalService: RetrievalService,
    private readonly configService: ConfigService<IConfig, true>,
    private walletSdkService: WalletSdkService,
  ) {
    this.dbScheduler = new DbAnchoredScheduler(this.logger);
  }

  async onModuleInit() {
    if (process.env.DEALBOT_DISABLE_SCHEDULER === "true") {
      this.logger.warn(
        "Scheduler disabled via DEALBOT_DISABLE_SCHEDULER=true; skipping wallet initialization and scheduler jobs.",
      );
      return;
    }
    await this.initializeWalletAndScheduler();
  }

  private async initializeWalletAndScheduler(): Promise<void> {
    this.logger.log("Initializing wallet allowances and scheduler...");

    try {
      await this.walletSdkService.ensureWalletAllowances();
      await this.setupDynamicSchedules();
      this.logger.log("Wallet and scheduler initialization completed successfully");
    } catch (error) {
      this.logger.fatal("Failed to initialize DEALBOT", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  private async setupDynamicSchedules(): Promise<void> {
    const config = this.configService.get<ISchedulingConfig>("scheduling");
    this.logger.log(`Scheduling configuration found: ${JSON.stringify(config)}`);

    await this.scheduleInitialRun({
      jobName: "dealCreation",
      intervalSeconds: config.dealIntervalSeconds,
      startOffsetSeconds: config.dealStartOffsetSeconds,
      getLastRunAt: () => this.dealService.getLastCreatedTime(),
      run: this.handleDealCreation.bind(this),
    });

    await this.scheduleInitialRun({
      jobName: "retrievalTests",
      intervalSeconds: config.retrievalIntervalSeconds,
      startOffsetSeconds: config.retrievalStartOffsetSeconds,
      getLastRunAt: () => this.retrievalService.getLastCreatedTime(),
      run: this.handleRetrievalTests.bind(this),
    });

    this.logger.log(
      `Scheduler setup: Deal creation interval ${config.dealIntervalSeconds}s, ` +
        `Retrieval tests interval ${config.retrievalIntervalSeconds}s`,
    );
  }

  private async scheduleInitialRun({
    jobName,
    intervalSeconds,
    startOffsetSeconds,
    getLastRunAt,
    run,
  }: {
    jobName: string;
    intervalSeconds: number;
    startOffsetSeconds: number;
    getLastRunAt: () => Promise<Date | null>;
    run: () => Promise<void>;
  }): Promise<void> {
    await this.dbScheduler.scheduleInitialRun({
      jobName,
      intervalSeconds,
      startOffsetSeconds,
      getLastRunAt,
      run,
    });
  }

  async handleDealCreation() {
    if (this.isRunningDealCreation) {
      this.logger.warn("Previous deal creation job still running, skipping...");
      return;
    }

    this.isRunningDealCreation = true;
    this.logger.log("Starting scheduled deal creation for all registered providers");

    try {
      await this.walletSdkService.loadProviders();

      const providerCount = this.walletSdkService.getTestingProvidersCount();

      if (providerCount === 0) {
        this.logger.warn("No registered providers found, skipping deal creation");
        return;
      }

      this.logger.log(`Testing ${providerCount} registered FWSS providers (includes both approved and non-approved)`);

      const deals = await this.dealService.createDealsForAllProviders();
      this.logger.log(`Scheduled deal creation completed for ${deals.length} deals`);
    } catch (error) {
      this.logger.error("Failed to create scheduled deals", error);
    } finally {
      this.isRunningDealCreation = false;
    }
  }

  async handleRetrievalTests() {
    if (this.isRunningRetrievalTests) {
      this.logger.warn("Previous retrieval test still running, aborting before starting a new run...");
      this.retrievalAbortController?.abort();

      if (this.retrievalRunPromise) {
        try {
          await this.retrievalRunPromise;
        } catch (error) {
          this.logger.warn("Previous retrieval run ended after abort", error);
        }
      }
    }

    this.isRunningRetrievalTests = true;
    const abortController = new AbortController();
    this.retrievalAbortController = abortController;

    this.retrievalRunPromise = (async () => {
      this.logger.log("Starting scheduled retrieval tests");

      try {
        const providerCount = this.walletSdkService.getTestingProvidersCount();

        if (providerCount === 0) {
          this.logger.warn("No registered providers found, skipping retrieval tests");
          return;
        }

        // Calculate the maximum time this job is allowed to run
        // Interval (seconds) * 1000 - Buffer (milliseconds)
        // e.g. 1 hour interval (3600s) - 60s buffer = 3540s timeout
        const schedulerConfig = this.configService.get("scheduling");
        const timeoutsConfig = this.configService.get("timeouts");

        const intervalMs = schedulerConfig.retrievalIntervalSeconds * 1000;
        const bufferMs = timeoutsConfig.retrievalTimeoutBufferMs;
        // Ensure we have at least 10 seconds if the buffer is too large relative to the interval
        const timeoutMs = Math.max(10000, intervalMs - bufferMs);
        const httpTimeoutMs = Math.max(timeoutsConfig.httpRequestTimeoutMs, timeoutsConfig.http2RequestTimeoutMs);

        if (timeoutMs < httpTimeoutMs) {
          this.logger.warn(
            `Retrieval interval (${intervalMs}ms) minus buffer (${bufferMs}ms) yields ${timeoutMs}ms, ` +
              `which is less than the HTTP timeout (${httpTimeoutMs}ms). ` +
              "Retrieval batches may be skipped unless the interval or timeouts are adjusted.",
          );
        }

        this.logger.log(
          `Starting batch retrieval with timeout of ${Math.round(timeoutMs / 1000)}s ` +
            `(Interval: ${schedulerConfig.retrievalIntervalSeconds}s, Buffer: ${Math.round(bufferMs / 1000)}s)`,
        );

        const result = await this.retrievalService.performRandomBatchRetrievals(
          providerCount,
          timeoutMs,
          abortController.signal,
        );
        this.logger.log(`Scheduled retrieval tests completed for ${result.length} retrievals`);
      } catch (error) {
        this.logger.error("Failed to perform scheduled retrievals", error);
      } finally {
        if (this.retrievalAbortController === abortController) {
          this.retrievalAbortController = undefined;
        }
        this.isRunningRetrievalTests = false;
      }
    })();

    await this.retrievalRunPromise;
  }
}
