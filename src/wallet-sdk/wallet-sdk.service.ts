import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JsonRpcProvider, MaxUint256 } from "ethers";
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
  // All registered providers in FWSS (for testing all SPs)
  registeredProviders: ProviderInfo[] = [];
  // IDs of approved providers (for Synapse filtering)
  private approvedProviderIds: Set<number> = new Set();

  constructor(private readonly configService: ConfigService<IConfig, true>) {}

  async onModuleInit() {
    await this.initializeServices();
    await this.loadAllRegisteredProviders();
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
   * Load ALL registered service providers from on-chain (not just approved)
   * This allows dealbot to test all FWSS SPs, even those not yet approved
   * Only loads active providers that support the PDP product and excludes dev-tagged providers
   */
  async loadAllRegisteredProviders(): Promise<void> {
    try {
      this.logger.log("Loading all registered service providers from on-chain...");
      
      // Get approved provider IDs for tracking
      const approvedIds = await this.warmStorageService.getApprovedProviderIds();
      this.approvedProviderIds = new Set(approvedIds.map(id => Number(id)));
      
      // Get total provider count from registry
      const providerCount = await this.spRegistry.getProviderCount();
      this.logger.log(`Found ${providerCount} total providers in registry`);
      
      // Load all providers (IDs start from 1)
      const providerPromises: Promise<ProviderInfo | null>[] = [];
      for (let i = 1; i <= Number(providerCount); i++) {
        providerPromises.push(this.spRegistry.getProvider(i));
      }
      
      const allProviderInfos = await Promise.all(providerPromises);
      const validProviders = allProviderInfos.filter((info): info is ProviderInfo => info !== null);
      
      // Filter for active providers that support PDP product and are not tagged as dev
      this.registeredProviders = validProviders.filter(provider => {
        const isActive = provider.active;
        const supportsPDP = !!provider.products?.PDP;
        const isDevTagged = provider.products?.PDP?.capabilities?.service_status === 'dev';
        
        if (!isActive) {
          this.logger.debug(`Skipping inactive provider: ${provider.name} (ID: ${provider.id})`);
        }
        if (!supportsPDP) {
          this.logger.debug(`Skipping provider without PDP support: ${provider.name} (ID: ${provider.id})`);
        }
        if (isDevTagged) {
          this.logger.debug(`Skipping dev-tagged provider: ${provider.name} (ID: ${provider.id})`);
        }
        
        return isActive && supportsPDP && !isDevTagged;
      });

      const approvedCount = this.registeredProviders.filter(p => 
        this.approvedProviderIds.has(p.id)
      ).length;
      
      const skippedCount = validProviders.length - this.registeredProviders.length;

      this.logger.log(
        `Loaded ${this.registeredProviders.length} active providers with PDP support ` +
        `(${approvedCount} approved, ${this.registeredProviders.length - approvedCount} not approved, ` +
        `${skippedCount} skipped)`
      );
    } catch (error) {
      this.logger.error("Failed to load registered providers from on-chain", error);
      // Fallback to empty array, let the application handle this gracefully
      this.registeredProviders = [];
      this.approvedProviderIds = new Set();
    }
  }

  /**
   * Load approved service providers from on-chain
   * @deprecated Use loadAllRegisteredProviders() instead. Kept for backward compatibility.
   */
  async loadApprovedProviders(): Promise<void> {
    await this.loadAllRegisteredProviders();
  }

  /**
   * Get ALL registered service providers (for testing all FWSS SPs)
   */
  getAllRegisteredProviders(): ProviderInfo[] {
    return [...this.registeredProviders];
  }

  /**
   * Get approved service providers only (for Synapse filtering)
   */
  getApprovedProviders(): ProviderInfo[] {
    return this.registeredProviders.filter(p => this.approvedProviderIds.has(p.id));
  }

  /**
   * Get approved provider addresses only
   */
  getApprovedProviderAddresses(): string[] {
    return this.getApprovedProviders().map((provider) => provider.serviceProvider);
  }

  /**
   * Get count of all registered providers (for deal creation across all FWSS SPs)
   */
  getProviderCount(): number {
    return this.registeredProviders.length;
  }

  /**
   * Get count of approved providers only
   */
  getApprovedProviderCount(): number {
    return this.getApprovedProviders().length;
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
   * Get provider info by address (searches all registered providers)
   */
  getProviderInfo(address: string): ProviderInfo | undefined {
    return this.registeredProviders.find((provider) => provider.serviceProvider === address);
  }

  /**
   * Get approved provider info by address
   * @deprecated Use getProviderInfo() instead
   */
  getApprovedProviderInfo(address: string): ProviderInfo | undefined {
    return this.getProviderInfo(address);
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
