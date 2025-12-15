import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { SchedulerRegistry } from "@nestjs/schedule";
import { scheduleJobWithOffset } from "../common/utils.js";
import type { IConfig, ISchedulingConfig } from "../config/app.config.js";
import type { DealService } from "../deal/deal.service.js";
import type { RetrievalService } from "../retrieval/retrieval.service.js";
import type { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);
  private isRunningDealCreation = false;
  private isRunningRetrievalTests = false;

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

    this.logger.log(
      `Staggered scheduler setup: Deal creation (offset: ${config.dealStartOffsetSeconds}s, interval: ${config.dealIntervalSeconds}s), ` +
        `Retrieval tests (offset: ${config.retrievalStartOffsetSeconds}s, interval: ${config.retrievalIntervalSeconds}s)`,
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
}
