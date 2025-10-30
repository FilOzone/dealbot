import {
  CONTRACT_ADDRESSES,
  type PaymentsService,
  type ProviderInfo,
  RPC_URLS,
  Synapse,
  TIME_CONSTANTS,
  WarmStorageService,
} from "@filoz/synapse-sdk";
import { SPRegistryService } from "@filoz/synapse-sdk/sp-registry";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JsonRpcProvider, MaxUint256 } from "ethers";
import type { IBlockchainConfig, IConfig } from "../config/app.config.js";
import type {
  FundDepositLog,
  ProviderInfoEx,
  ServiceApprovalLog,
  StorageRequirements,
  TransactionLog,
  WalletServices,
  WalletStatusLog,
} from "./wallet-sdk.types.js";

@Injectable()
export class WalletSdkService implements OnModuleInit {
  private readonly logger = new Logger(WalletSdkService.name);
  private readonly blockchainConfig: IBlockchainConfig;
  private paymentsService: PaymentsService;
  private warmStorageService: WarmStorageService;
  private spRegistry: SPRegistryService;
  allProviders: ProviderInfoEx[] = [];
  approvedProviderIds: Set<number> = new Set();

  constructor(private readonly configService: ConfigService<IConfig, true>) {
    this.blockchainConfig = this.configService.get<IBlockchainConfig>("blockchain");
  }

  async onModuleInit() {
    await this.initializeServices();
    await this.loadProviders();
  }

  /**
   * Initialize wallet services with provider and signer
   */
  private async initializeServices(): Promise<void> {
    const warmStorageAddress = this.getFWSSAddress();
    const synapse = await Synapse.create({
      privateKey: this.blockchainConfig.walletPrivateKey,
      rpcURL: RPC_URLS[this.blockchainConfig.network].http,
      warmStorageAddress,
    });

    const provider = new JsonRpcProvider(RPC_URLS[this.blockchainConfig.network].http);
    this.warmStorageService = await WarmStorageService.create(provider, warmStorageAddress);
    this.spRegistry = new SPRegistryService(provider, this.warmStorageService.getServiceProviderRegistryAddress());
    this.paymentsService = synapse.payments;
  }

  /**
   * Load approved service providers from on-chain
   */
  async loadProviders(): Promise<void> {
    try {
      this.logger.log("Loading all service providers from sp-registry...");

      const approvedIds = await this.warmStorageService.getApprovedProviderIds();
      this.approvedProviderIds = new Set(approvedIds);

      const providerCount = await this.spRegistry.getProviderCount();

      const providerPromises: Promise<ProviderInfo | null>[] = [];
      for (let i = 1; i <= Number(providerCount); i++) {
        providerPromises.push(this.spRegistry.getProvider(i));
      }

      const providerInfos = await Promise.all(providerPromises);
      const validProviders = providerInfos.filter((info) => !!info);

      this.allProviders = validProviders
        .filter((info) => {
          const isActive = info.active;
          const supportsPDP = !!info.products?.PDP;
          const isDevTagged = info.products?.PDP?.capabilities?.service_status === "dev";

          return isActive && supportsPDP && !isDevTagged;
        })
        .map((info) => {
          const isApproved = this.approvedProviderIds.has(info.id);
          return {
            ...info,
            isApproved,
          };
        });

      this.logger.log(
        `Loaded ${this.allProviders.length} providers from on-chain (${this.approvedProviderIds.size} approved)`,
      );
    } catch (error) {
      this.logger.error("Failed to load approved providers from on-chain", error);
      // Fallback to empty array, let the application handle this gracefully
      this.allProviders = [];
      this.approvedProviderIds = new Set();
    }
  }

  /**
   * Get approved provider addresses only
   */
  getProviderAddresses(): string[] {
    return this.allProviders.map((provider) => provider.serviceProvider);
  }

  /**
   * Get count of approved providers
   */
  getApprovedProvidersCount(): number {
    return this.approvedProviderIds.size;
  }

  /**
   * Get count of all providers
   */
  getAllProvidersCount(): number {
    return this.allProviders.length;
  }

  /**
   * Get count of testing providers
   */
  getTestingProvidersCount(): number {
    return this.blockchainConfig.useOnlyApprovedProviders ? this.approvedProviderIds.size : this.allProviders.length;
  }

  /**
   * Get approved providers
   */
  getApprovedProviders(): ProviderInfoEx[] {
    return this.allProviders.filter((provider) => provider.isApproved);
  }

  /**
   * Get all providers
   */
  getAllProviders(): ProviderInfoEx[] {
    return [...this.allProviders];
  }

  /**
   * Get testing providers
   */
  getTestingProviders(): ProviderInfoEx[] {
    return this.blockchainConfig.useOnlyApprovedProviders
      ? this.allProviders.filter((p) => p.isApproved)
      : [...this.allProviders];
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
  getProviderInfo(address: string): ProviderInfoEx | undefined {
    return this.allProviders.find((provider) => provider.serviceProvider === address);
  }

  /**
   * Calculate storage requirements including costs and allowances
   */
  async calculateStorageRequirements(): Promise<StorageRequirements> {
    const providerCount = this.blockchainConfig.useOnlyApprovedProviders
      ? this.getApprovedProvidersCount()
      : this.getAllProvidersCount();

    const STORAGE_SIZE_GB = 100;
    const APPROVAL_DURATION_MONTHS = 6n;
    const datasetCreationFees = this.blockchainConfig.checkDatasetCreationFees
      ? this.calculateDatasetCreationFees(providerCount)
      : 0n;

    const [accountInfo, storageCheck, serviceApprovals] = await Promise.all([
      this.paymentsService.accountInfo(),
      this.warmStorageService.checkAllowanceForStorage(
        STORAGE_SIZE_GB * 1024 * 1024 * 1024,
        true,
        this.paymentsService,
      ),
      this.paymentsService.serviceApproval(this.getFWSSAddress()),
    ]);

    return {
      accountInfo,
      providerCount,
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
  private calculateDatasetCreationFees(providerCount: number): bigint {
    const minDataSetPerSP = 2n; // withCDN & withoutCDN
    const datasetCreationFees = 1n * 10n ** 17n; // 0.1 USDFC
    return minDataSetPerSP * datasetCreationFees * BigInt(providerCount);
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
      providerCount: requirements.providerCount,
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
    const contractAddress = this.getFWSSAddress();

    const approvalLog: ServiceApprovalLog = {
      serviceAddress: contractAddress,
      rateAllowance: "Maximum of uint256",
      lockupAllowance: "Maximum of uint256",
      durationMonths: Number(requirements.approvalDuration / TIME_CONSTANTS.EPOCHS_PER_MONTH),
    };

    this.logger.log("Approving storage service allowances", approvalLog);

    const approveTx = await this.paymentsService.approveService(
      contractAddress,
      MaxUint256,
      MaxUint256,
      requirements.approvalDuration,
    );

    await approveTx.wait();

    const successLog: TransactionLog = {
      transactionHash: approveTx.hash,
      serviceAddress: contractAddress,
    };

    this.logger.log("Storage service approved successfully", successLog);
  }

  getFWSSAddress(): string {
    return this.blockchainConfig.overrideContractAddresses && this.blockchainConfig.warmStorageServiceAddress
      ? this.blockchainConfig.warmStorageServiceAddress
      : CONTRACT_ADDRESSES.WARM_STORAGE[this.blockchainConfig.network];
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
