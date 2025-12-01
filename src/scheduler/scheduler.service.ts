import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { scheduleJobWithOffset } from "../common/utils.js";
import type { IConfig, ISchedulingConfig, IWalletMonitorConfig } from "../config/app.config.js";
import { DealService } from "../deal/deal.service.js";
import { RetrievalService } from "../retrieval/retrieval.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);
  private isRunningDealCreation = false;
  private isRunningRetrievalTests = false;
  private isRunningBalanceCheck = false;

  constructor(
    private dealService: DealService,
    private retrievalService: RetrievalService,
    private readonly configService: ConfigService<IConfig, true>,
    private schedulerRegistry: SchedulerRegistry,
    private walletSdkService: WalletSdkService,
  ) {}

  async onModuleInit() {
    await this.initializeWalletAndScheduler();
  }

  private async initializeWalletAndScheduler(): Promise<void> {
    this.logger.log("Initializing wallet allowances and scheduler...");

    try {
      await this.walletSdkService.ensureWalletAllowances();
      this.setupDynamicCronJobs();
      this.logger.log("Wallet and scheduler initialization completed successfully");
    } catch (error) {
      this.logger.fatal("Failed to initialize DEALBOT", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  private setupDynamicCronJobs() {
    const config = this.configService.get<ISchedulingConfig>("scheduling");
    const walletMonitorConfig = this.configService.get<IWalletMonitorConfig>("walletMonitor");
    this.logger.log(`Scheduling configuration found: ${JSON.stringify(config)}`);

    scheduleJobWithOffset(
      "dealCreation",
      config.dealStartOffsetSeconds,
      config.dealIntervalSeconds,
      this.schedulerRegistry,
      this.handleDealCreation.bind(this),
      this.logger,
    );

    scheduleJobWithOffset(
      "retrievalTests",
      config.retrievalStartOffsetSeconds,
      config.retrievalIntervalSeconds,
      this.schedulerRegistry,
      this.handleRetrievalTests.bind(this),
      this.logger,
    );

    // Wallet balance monitor with stagger after metrics job
    const balanceCheckOffset = config.metricsStartOffsetSeconds + 600; // 10 min after metrics
    scheduleJobWithOffset(
      "walletBalanceMonitor",
      balanceCheckOffset,
      walletMonitorConfig.balanceCheckIntervalSeconds,
      this.schedulerRegistry,
      this.handleWalletBalanceCheck.bind(this),
      this.logger,
    );

    this.logger.log(
      `Staggered scheduler setup: Deal creation (offset: ${config.dealStartOffsetSeconds}s, interval: ${config.dealIntervalSeconds}s), ` +
        `Retrieval tests (offset: ${config.retrievalStartOffsetSeconds}s, interval: ${config.retrievalIntervalSeconds}s), ` +
        `Wallet balance monitor (offset: ${balanceCheckOffset}s, interval: ${walletMonitorConfig.balanceCheckIntervalSeconds}s)`,
    );
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
      this.logger.warn("Previous retrieval test still running, skipping...");
      return;
    }

    this.isRunningRetrievalTests = true;
    this.logger.log("Starting scheduled retrieval tests");

    try {
      const providerCount = this.walletSdkService.getTestingProvidersCount();

      if (providerCount === 0) {
        this.logger.warn("No registered providers found, skipping retrieval tests");
        return;
      }
      const result = await this.retrievalService.performRandomBatchRetrievals(providerCount);
      this.logger.log(`Scheduled retrieval tests completed for ${result.length} retrievals`);
    } catch (error) {
      this.logger.error("Failed to perform scheduled retrievals", error);
    } finally {
      this.isRunningRetrievalTests = false;
    }
  }

  async handleWalletBalanceCheck() {
    if (this.isRunningBalanceCheck) {
      this.logger.debug("Previous wallet balance check still running, skipping...");
      return;
    }

    this.isRunningBalanceCheck = true;
    this.logger.debug("Starting scheduled wallet balance check");

    try {
      await this.walletSdkService.checkAndHandleBalance();
    } catch (error) {
      this.logger.error("Failed to check wallet balance", error);
    } finally {
      this.isRunningBalanceCheck = false;
    }
  }
}
