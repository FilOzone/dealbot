import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { CronJob } from "cron";
import { DealService } from "../deal/deal.service";
import { RetrievalService } from "../retrieval/retrieval.service";
import { IAppConfig } from "../config/app.config";
import { getProviderCount } from "src/common/providers";

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);
  private isRunningDealCreation = false;
  private isRunningRetrievalTests = false;

  constructor(
    private dealService: DealService,
    private retrievalService: RetrievalService,
    private readonly configService: ConfigService<IAppConfig>,
    private schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit() {
    this.setupDynamicCronJobs();
  }

  private setupDynamicCronJobs() {
    const config = this.configService.get("scheduling", { infer: true });

    if (!config) {
      this.logger.error("Scheduling configuration not found, using default intervals");
      return;
    }

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
      const result = await this.retrievalService.performRandomBatchRetrievals(getProviderCount());
      this.logger.log(`Scheduled retrieval tests completed for ${result.length} retrievals`);
    } catch (error) {
      this.logger.error("Failed to perform scheduled retrievals", error);
    } finally {
      this.isRunningRetrievalTests = false;
    }
  }
}
