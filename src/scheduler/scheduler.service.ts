import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { SchedulerRegistry } from "@nestjs/schedule";
import { CronJob } from "cron";
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

    const dealIntervalSeconds = config.dealIntervalSeconds;
    const dealCronExpression = this.secondsToCronExpression(dealIntervalSeconds);

    const dealJob = new CronJob(dealCronExpression, () => {
      this.handleDealCreation();
    });

    this.schedulerRegistry.addCronJob("dealCreation", dealJob);
    dealJob.start();

    const retrievalIntervalSeconds = config.retrievalIntervalSeconds;
    const retrievalCronExpression = this.secondsToCronExpression(retrievalIntervalSeconds);

    const retrievalJob = new CronJob(retrievalCronExpression, () => {
      this.handleRetrievalTests();
    });

    this.schedulerRegistry.addCronJob("retrievalTests", retrievalJob);
    retrievalJob.start();

    this.logger.log(
      `Dynamic cron jobs setup: Deal creation every ${dealIntervalSeconds}s, Retrieval tests every ${retrievalIntervalSeconds}s`,
    );
  }

  private secondsToCronExpression(seconds: number): string {
    if (seconds < 60) {
      return `*/${seconds} * * * * *`;
    } else if (seconds === 60) {
      return "0 * * * * *";
    } else if (seconds % 60 === 0) {
      const minutes = seconds / 60;
      return `0 */${minutes} * * * *`;
    } else {
      return `*/${seconds} * * * * *`;
    }
  }

  async handleDealCreation() {
    if (this.isRunningDealCreation) {
      this.logger.warn("Previous deal creation job still running, skipping...");
      return;
    }

    this.isRunningDealCreation = true;
    this.logger.log("Starting scheduled deal creation for all providers");

    try {
      await this.walletSdkService.loadApprovedProviders();

      const providerCount = this.walletSdkService.getProviderCount();

      if (providerCount === 0) {
        this.logger.warn("No approved providers found, skipping deal creation");
        return;
      }

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
      const providerCount = this.walletSdkService.getProviderCount();

      if (providerCount === 0) {
        this.logger.warn("No approved providers found, skipping retrieval tests");
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
