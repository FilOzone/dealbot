import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { CronJob } from "cron";
import { DealService } from "../deal/deal.service.js";
import { RetrievalService } from "../retrieval/retrieval.service.js";
import { IAppConfig } from "../config/app.config.js";
import { getProviderCount, providers } from "../common/providers.js";
import { JsonRpcProvider } from "ethers";
import { CONTRACT_ADDRESSES, PaymentsService, RPC_URLS, WarmStorageService } from "@filoz/synapse-sdk";
import { Wallet } from "ethers";
import type {
  WalletServices,
  StorageRequirements,
  WalletStatusLog,
  FundDepositLog,
  TransactionLog,
  ServiceApprovalLog,
} from "./scheduler.types.js";

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

  async onModuleInit() {
    await this.initializeWalletAndScheduler();
  }

  private async initializeWalletAndScheduler(): Promise<void> {
    this.logger.log("Initializing wallet allowances and scheduler...");

    try {
      await this.ensureWalletAllowances();
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

  private async ensureWalletAllowances(): Promise<void> {
    const { paymentsService, warmStorageService } = await this.setupWalletServices();
    const requirements = await this.calculateStorageRequirements(paymentsService, warmStorageService);

    this.logWalletStatus(requirements);

    if (this.requiresTopUp(requirements)) {
      await this.handleInsufficientFunds(paymentsService, requirements);
    }

    if (this.requiresApproval(requirements)) {
      await this.approveStorageService(paymentsService, requirements);
    }
  }

  private async setupWalletServices(): Promise<WalletServices> {
    const walletConfig = this.configService.get("blockchain", { infer: true });
    if (!walletConfig?.walletPrivateKey) {
      throw new Error("Wallet private key not configured");
    }

    const provider = new JsonRpcProvider(RPC_URLS.calibration.http);
    const signer = new Wallet(walletConfig.walletPrivateKey, provider);
    const paymentsService = new PaymentsService(provider, signer, "calibration", false);
    const warmStorageService = new WarmStorageService(
      provider,
      CONTRACT_ADDRESSES.WARM_STORAGE.calibration,
      CONTRACT_ADDRESSES.PDP_VERIFIER.calibration,
    );

    return { paymentsService, warmStorageService };
  }

  private async calculateStorageRequirements(
    paymentsService: PaymentsService,
    warmStorageService: WarmStorageService,
  ): Promise<StorageRequirements> {
    const STORAGE_SIZE_GB = 100;
    const APPROVAL_DURATION_MONTHS = 6;
    const datasetCreationFees = this.calculateDatasetCreationFees();

    const [accountInfo, storageCheck, serviceApprovals] = await Promise.all([
      paymentsService.accountInfo(),
      warmStorageService.checkAllowanceForStorage(STORAGE_SIZE_GB * 1024 * 1024 * 1024, true, paymentsService),
      paymentsService.serviceApproval(CONTRACT_ADDRESSES.WARM_STORAGE.calibration),
    ]);

    return {
      accountInfo,
      storageCheck,
      serviceApprovals,
      datasetCreationFees,
      totalRequiredFunds: storageCheck.costs.perMonth + datasetCreationFees,
      approvalDuration: BigInt(86400 * APPROVAL_DURATION_MONTHS), // 6 months in epochs
    };
  }

  private calculateDatasetCreationFees(): bigint {
    return 2n * 1n * 10n ** 17n * BigInt(getProviderCount());
  }

  private logWalletStatus(requirements: StorageRequirements): void {
    const logData: WalletStatusLog = {
      availableFunds: requirements.accountInfo.funds.toString(),
      requiredMonthlyFunds: requirements.storageCheck.costs.perMonth.toString(),
      datasetCreationFees: requirements.datasetCreationFees.toString(),
      totalRequired: requirements.totalRequiredFunds.toString(),
      providerCount: getProviderCount(),
    };

    this.logger.log("Wallet status check completed", logData);
  }

  private requiresTopUp(requirements: StorageRequirements): boolean {
    return requirements.accountInfo.funds < requirements.totalRequiredFunds;
  }

  private requiresApproval(requirements: StorageRequirements): boolean {
    return (
      requirements.serviceApprovals.rateAllowance < requirements.storageCheck.rateAllowanceNeeded ||
      requirements.serviceApprovals.lockupAllowance <
        requirements.storageCheck.lockupAllowanceNeeded + requirements.datasetCreationFees
    );
  }

  private async handleInsufficientFunds(
    paymentsService: PaymentsService,
    requirements: StorageRequirements,
  ): Promise<void> {
    const depositAmount = requirements.totalRequiredFunds - requirements.accountInfo.funds;

    const depositLog: FundDepositLog = {
      currentFunds: requirements.accountInfo.funds.toString(),
      requiredFunds: requirements.totalRequiredFunds.toString(),
      depositAmount: depositAmount.toString(),
    };

    this.logger.log("Depositing additional funds", depositLog);

    const depositTx = await paymentsService.deposit(depositAmount);
    await depositTx.wait();

    const successLog: TransactionLog = {
      transactionHash: depositTx.hash,
      depositAmount: depositAmount.toString(),
    };

    this.logger.log("Funds deposited successfully", successLog);
  }

  private async approveStorageService(
    paymentsService: PaymentsService,
    requirements: StorageRequirements,
  ): Promise<void> {
    const contractAddress = CONTRACT_ADDRESSES.WARM_STORAGE.calibration;

    const approvalLog: ServiceApprovalLog = {
      serviceAddress: contractAddress,
      rateAllowance: requirements.storageCheck.rateAllowanceNeeded.toString(),
      lockupAllowance: (requirements.storageCheck.lockupAllowanceNeeded + requirements.datasetCreationFees).toString(),
      durationMonths: 6,
    };

    this.logger.log("Approving storage service allowances", approvalLog);

    const approveTx = await paymentsService.approveService(
      contractAddress,
      requirements.storageCheck.rateAllowanceNeeded,
      requirements.storageCheck.lockupAllowanceNeeded + requirements.datasetCreationFees,
      requirements.approvalDuration,
    );

    await approveTx.wait();

    const successLog: TransactionLog = {
      transactionHash: approveTx.hash,
      serviceAddress: contractAddress,
    };

    this.logger.log("Storage service approved successfully", successLog);
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
