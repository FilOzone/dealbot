import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JsonRpcProvider } from "ethers";
import {
  CONTRACT_ADDRESSES,
  PaymentsService,
  RPC_URLS,
  WarmStorageService,
  TIME_CONSTANTS,
  ProviderInfo,
  Synapse,
} from "@filoz/synapse-sdk";
import { SPRegistryService } from "@filoz/synapse-sdk/sp-registry";
import type { IBlockchainConfig, IConfig } from "../config/app.config.js";
import type {
  WalletServices,
  StorageRequirements,
  WalletStatusLog,
  FundDepositLog,
  TransactionLog,
  ServiceApprovalLog,
} from "./wallet-sdk.types.js";

@Injectable()
export class WalletSdkService implements OnModuleInit {
  private readonly logger = new Logger(WalletSdkService.name);
  private paymentsService: PaymentsService;
  private warmStorageService: WarmStorageService;
  private spRegistry: SPRegistryService;
  approvedProviders: ProviderInfo[] = [];

  constructor(private readonly configService: ConfigService<IConfig, true>) {}

  async onModuleInit() {
    await this.initializeServices();
    await this.loadApprovedProviders();
  }

  /**
   * Initialize wallet services with provider and signer
   */
  private async initializeServices(): Promise<void> {
    const blockchainConfig = this.configService.get<IBlockchainConfig>("blockchain");

    const synapse = await Synapse.create({
      privateKey: blockchainConfig.walletPrivateKey,
      rpcURL: RPC_URLS[blockchainConfig.network].http,
    });

    const warmStorageAddress = synapse.getWarmStorageAddress();
    const provider = new JsonRpcProvider(RPC_URLS[blockchainConfig.network].http);
    this.warmStorageService = await WarmStorageService.create(provider, warmStorageAddress);
    this.spRegistry = new SPRegistryService(provider, this.warmStorageService.getServiceProviderRegistryAddress());
    this.paymentsService = synapse.payments;
  }

  /**
   * Load approved service providers from on-chain
   */
  async loadApprovedProviders(): Promise<void> {
    try {
      this.logger.log("Loading approved service providers from on-chain...");
      const approvedProviderIds = await this.warmStorageService.getApprovedProviderIds();

      for (const id of approvedProviderIds) {
        const providerInfo = await this.spRegistry.getProvider(id);
        this.approvedProviders.push(providerInfo!);
      }

      this.logger.log(`Loaded ${this.approvedProviders.length} approved providers from on-chain`);
    } catch (error) {
      this.logger.error("Failed to load approved providers from on-chain", error);
      // Fallback to empty array, let the application handle this gracefully
      this.approvedProviders = [];
    }
  }

  /**
   * Get approved service providers
   */
  getApprovedProviders(): any[] {
    return [...this.approvedProviders];
  }

  /**
   * Get approved provider addresses only
   */
  getApprovedProviderAddresses(): string[] {
    return this.approvedProviders.map((provider) => provider.serviceProvider);
  }

  /**
   * Get count of approved providers
   */
  getProviderCount(): number {
    return this.approvedProviders.length;
  }

  /**
   * Get wallet services (now returns instance variables)
   */
  getWalletServices(): WalletServices {
    return {
      paymentsService: this.paymentsService,
      warmStorageService: this.warmStorageService,
    };
  }

  /**
   * Get approved provider info by address
   */
  getApprovedProviderInfo(address: string): ProviderInfo | undefined {
    return this.approvedProviders.find((provider) => provider.serviceProvider === address);
  }

  /**
   * Calculate storage requirements including costs and allowances
   */
  async calculateStorageRequirements(): Promise<StorageRequirements> {
    const blockchainConfig = this.configService.get<IBlockchainConfig>("blockchain");

    const STORAGE_SIZE_GB = 100;
    const APPROVAL_DURATION_MONTHS = 6n;
    const datasetCreationFees = blockchainConfig.checkDatasetCreationFees ? this.calculateDatasetCreationFees() : 0n;

    const [accountInfo, storageCheck, serviceApprovals] = await Promise.all([
      this.paymentsService.accountInfo(),
      this.warmStorageService.checkAllowanceForStorage(
        STORAGE_SIZE_GB * 1024 * 1024 * 1024,
        true,
        this.paymentsService,
      ),
      this.paymentsService.serviceApproval(CONTRACT_ADDRESSES.WARM_STORAGE[blockchainConfig.network]),
    ]);

    return {
      accountInfo,
      storageCheck,
      serviceApprovals,
      datasetCreationFees,
      totalRequiredFunds: storageCheck.costs.perMonth * APPROVAL_DURATION_MONTHS + datasetCreationFees,
      approvalDuration: BigInt(TIME_CONSTANTS.EPOCHS_PER_MONTH * APPROVAL_DURATION_MONTHS), // 6 months in epochs
    };
  }

  /**
   * Calculate fees required for dataset creation across all providers
   */
  private calculateDatasetCreationFees(): bigint {
    const minDataSetPerSP = 2n; // withCDN & withoutCDN
    const datasetCreationFees = 1n * 10n ** 17n; // 0.1 USDFC
    return minDataSetPerSP * datasetCreationFees * BigInt(this.getProviderCount());
  }

  /**
   * Log current wallet status and requirements
   */
  logWalletStatus(requirements: StorageRequirements): void {
    const logData: WalletStatusLog = {
      availableFunds: requirements.accountInfo.funds.toString(),
      requiredMonthlyFunds: requirements.storageCheck.costs.perMonth.toString(),
      datasetCreationFees: requirements.datasetCreationFees.toString(),
      totalRequired: requirements.totalRequiredFunds.toString(),
      providerCount: this.getProviderCount(),
    };

    this.logger.log("Wallet status check completed", logData);
  }

  /**
   * Check if wallet requires additional funds
   */
  requiresTopUp(requirements: StorageRequirements): boolean {
    return requirements.accountInfo.funds < requirements.totalRequiredFunds;
  }

  /**
   * Check if wallet requires service approval
   */
  requiresApproval(requirements: StorageRequirements): boolean {
    return (
      requirements.serviceApprovals.rateAllowance < requirements.storageCheck.rateAllowanceNeeded ||
      requirements.serviceApprovals.lockupAllowance <
        requirements.storageCheck.lockupAllowanceNeeded + requirements.datasetCreationFees
    );
  }

  /**
   * Handle insufficient funds by depositing required amount
   */
  async handleInsufficientFunds(requirements: StorageRequirements): Promise<void> {
    const depositAmount = requirements.totalRequiredFunds - requirements.accountInfo.funds;

    const depositLog: FundDepositLog = {
      currentFunds: requirements.accountInfo.funds.toString(),
      requiredFunds: requirements.totalRequiredFunds.toString(),
      depositAmount: depositAmount.toString(),
    };

    this.logger.log("Depositing additional funds", depositLog);

    const depositTx = await this.paymentsService.deposit(depositAmount);
    await depositTx.wait();

    const successLog: TransactionLog = {
      transactionHash: depositTx.hash,
      depositAmount: depositAmount.toString(),
    };

    this.logger.log("Funds deposited successfully", successLog);
  }

  /**
   * Approve storage service with required allowances
   */
  async approveStorageService(requirements: StorageRequirements): Promise<void> {
    const blockchainConfig = this.configService.get<IBlockchainConfig>("blockchain");
    const contractAddress = CONTRACT_ADDRESSES.WARM_STORAGE[blockchainConfig.network];

    const approvalLog: ServiceApprovalLog = {
      serviceAddress: contractAddress,
      rateAllowance: requirements.storageCheck.rateAllowanceNeeded.toString(),
      lockupAllowance: (requirements.storageCheck.lockupAllowanceNeeded + requirements.datasetCreationFees).toString(),
      durationMonths: Number(requirements.approvalDuration / TIME_CONSTANTS.EPOCHS_PER_MONTH),
    };

    this.logger.log("Approving storage service allowances", approvalLog);

    const approveTx = await this.paymentsService.approveService(
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

  /**
   * Ensure wallet has sufficient allowances for operations
   */
  async ensureWalletAllowances(): Promise<void> {
    const requirements = await this.calculateStorageRequirements();

    this.logWalletStatus(requirements);

    if (this.requiresTopUp(requirements)) {
      await this.handleInsufficientFunds(requirements);
    }

    if (this.requiresApproval(requirements)) {
      await this.approveStorageService(requirements);
    }
  }
}
