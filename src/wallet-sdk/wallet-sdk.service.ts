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
import { InjectRepository } from "@nestjs/typeorm";
import { JsonRpcProvider, MaxUint256 } from "ethers";
import { Repository } from "typeorm";
import { Hex } from "viem";
import { DEV_TAG } from "../common/constants.js";
import type { IBlockchainConfig, IConfig, IWalletMonitorConfig } from "../config/app.config.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { AlertService } from "./alert.service.js";
import type {
  FundDepositLog,
  ProviderInfoEx,
  ServiceApprovalLog,
  StorageRequirements,
  TransactionLog,
  WalletServices,
  WalletStatusLog,
} from "./wallet-sdk.types.js";

export interface IDepositCallbacks {
  onAllowanceCheck?: (allowance: bigint) => void;
  onApprovalTransaction?: (tx: { hash: string }) => void;
  onApprovalConfirmed?: (receipt: { hash?: string }) => void;
  onDepositStarting?: () => void;
}

@Injectable()
export class WalletSdkService implements OnModuleInit {
  private readonly logger = new Logger(WalletSdkService.name);
  private readonly blockchainConfig: IBlockchainConfig;
  private readonly walletMonitorConfig: IWalletMonitorConfig;
  private paymentsService: PaymentsService;
  private warmStorageService: WarmStorageService;
  private spRegistry: SPRegistryService;
  private paymentsAddress: string | undefined;
  private providerCache: Map<string, ProviderInfoEx> = new Map();
  private activeProviderAddresses: Set<string> = new Set();
  private approvedProviderAddresses: Set<string> = new Set();

  // Auto-fund/alert state
  private balanceCheckLock = false;
  private lastActionTimestampMs = 0;

  constructor(
    private readonly configService: ConfigService<IConfig, true>,
    @InjectRepository(StorageProvider)
    private readonly spRepository: Repository<StorageProvider>,
    private readonly alertService: AlertService,
  ) {
    this.blockchainConfig = this.configService.get<IBlockchainConfig>("blockchain");
    this.walletMonitorConfig = this.configService.get<IWalletMonitorConfig>("walletMonitor");
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
    this.paymentsAddress = synapse.getPaymentsAddress();
  }

  /**
   * Load ALL registered service providers from on-chain (not just approved)
   * This allows dealbot to test all FWSS SPs, even those not yet approved
   * Only loads active providers that support the PDP product and excludes dev-tagged providers
   */
  async loadProviders(): Promise<void> {
    try {
      this.logger.log("Loading all service providers from sp-registry...");

      const approvedIds = await this.warmStorageService.getApprovedProviderIds();

      const providerCount = await this.spRegistry.getProviderCount();

      const providerPromises: Promise<ProviderInfo | null>[] = [];
      for (let i = 1; i <= Number(providerCount); i++) {
        providerPromises.push(this.spRegistry.getProvider(i));
      }

      const providerInfos = await Promise.all(providerPromises);
      const validProviders = providerInfos.filter((info) => !!info);

      this.providerCache.clear();
      const extendedProviders = validProviders.map((info) => {
        const isActivePDP = info.active;
        const supportsPDP = !!info.products?.PDP;
        const isDevTagged = info.products?.PDP?.capabilities?.service_status === DEV_TAG;

        const isActive = isActivePDP && supportsPDP && !isDevTagged;
        const isApproved = approvedIds.includes(info.id);

        // select approved providers which are not dev tagged
        if (isActive) this.activeProviderAddresses.add(info.serviceProvider);
        if (isApproved && isActive) this.approvedProviderAddresses.add(info.serviceProvider);
        this.providerCache.set(info.serviceProvider, {
          ...info,
          isApproved,
          active: isActive,
        });

        return {
          ...info,
          isApproved,
          active: isActive,
        };
      });

      this.syncProvidersToDatabase(extendedProviders).catch((err) =>
        this.logger.error(`Failed to sync providers to DB: ${err.message}`),
      );

      this.logger.log(
        `Loaded ${this.providerCache.size} providers from on-chain (${this.activeProviderAddresses.size} testing) (${this.approvedProviderAddresses.size} approved)`,
      );
    } catch (error) {
      this.logger.error("Failed to load registered providers from on-chain", error);
      // Fallback to empty array, let the application handle this gracefully
      this.providerCache.clear();
      this.activeProviderAddresses.clear();
      this.approvedProviderAddresses.clear();
    }
  }

  /**
   * Get count of approved providers
   */
  getApprovedProvidersCount(): number {
    return this.approvedProviderAddresses.size;
  }

  /**
   * Get count of all providers
   */
  getAllActiveProvidersCount(): number {
    return this.activeProviderAddresses.size;
  }

  /**
   * Get count of testing providers
   */
  getTestingProvidersCount(): number {
    return this.blockchainConfig.useOnlyApprovedProviders
      ? this.getApprovedProvidersCount()
      : this.getAllActiveProvidersCount();
  }

  /**
   * Get approved providers
   */
  getApprovedProviders(): ProviderInfoEx[] {
    const approvedProviders: ProviderInfoEx[] = [];

    for (const address of this.approvedProviderAddresses) {
      const provider = this.providerCache.get(address);
      if (provider) approvedProviders.push(provider);
    }

    return approvedProviders;
  }

  /**
   * Get all active providers
   */
  getAllActiveProviders(): ProviderInfoEx[] {
    const activeProviders: ProviderInfoEx[] = [];

    for (const address of this.activeProviderAddresses) {
      const provider = this.providerCache.get(address);
      if (provider) activeProviders.push(provider);
    }

    return activeProviders;
  }

  /**
   * Get testing providers
   */
  getTestingProviders(): ProviderInfoEx[] {
    return this.blockchainConfig.useOnlyApprovedProviders ? this.getApprovedProviders() : this.getAllActiveProviders();
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
    return this.providerCache.get(address);
  }

  /**
   * Calculate storage requirements including costs and allowances
   */
  async calculateStorageRequirements(): Promise<StorageRequirements> {
    const providerCount = this.getTestingProvidersCount();

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

  // ============================================================================
  // Balance Monitoring & Auto-fund
  // ============================================================================

  private getPaymentsAddress(): string {
    return this.paymentsAddress ?? "";
  }

  private isCooldownActive(): boolean {
    const cooldownMs = (this.walletMonitorConfig?.cooldownMinutes ?? 30) * 60 * 1000;
    return Date.now() - this.lastActionTimestampMs < cooldownMs;
  }

  private markActionTimestamp(): void {
    this.lastActionTimestampMs = Date.now();
  }

  async checkAndHandleBalance(): Promise<void> {
    if (this.balanceCheckLock) {
      this.logger.debug("Wallet monitor is locked; skipping concurrent run");
      return;
    }
    this.balanceCheckLock = true;
    try {
      const thresholdStr = this.walletMonitorConfig?.balanceThresholdUsdfc ?? "0";
      const autoFundAmountStr = this.walletMonitorConfig?.autoFundAmountUsdfc ?? "0";
      const autoFundEnabled = this.walletMonitorConfig?.autoFundEnabled ?? false;
      const alertOnly = this.walletMonitorConfig?.alertOnlyMode ?? false;

      const threshold = BigInt(thresholdStr);
      const autoFundAmount = BigInt(autoFundAmountStr);

      // If no threshold configured, skip quietly
      if (threshold <= 0n) {
        this.logger.debug("Wallet monitor threshold is 0; skipping check");
        return;
      }

      // Current available funds in Payments account (USDFC)
      const availableFunds = await this.paymentsService.balance();

      if (availableFunds >= threshold) {
        this.logger.debug("Wallet available funds meet threshold; nothing to do", {
          availableFunds: availableFunds.toString(),
          threshold: threshold.toString(),
        });
        return;
      }

      // Enforce mandatory cooldown
      if (this.isCooldownActive()) {
        this.logger.warn("Wallet monitor cooldown active; skipping action", {
          lastActionAt: new Date(this.lastActionTimestampMs).toISOString(),
          cooldownMinutes: this.walletMonitorConfig?.cooldownMinutes ?? 30,
        });
        return;
      }

      // Check native FIL balance for gas (walletBalance(undefined) -> FIL)
      const filBalance = await this.paymentsService.walletBalance(undefined as any);
      if (filBalance <= 0n) {
        this.logger.warn("Insufficient FIL for gas; cannot auto-fund");
        await this.alertService.sendLowBalanceAlert({
          reason: "no_fil_gas",
          availableFunds: availableFunds.toString(),
          threshold: threshold.toString(),
          filBalance: filBalance.toString(),
        });
        this.markActionTimestamp();
        return;
      }

      // If alert-only mode or auto-fund disabled/amount zero => alert
      if (alertOnly || !autoFundEnabled || autoFundAmount <= 0n) {
        this.logger.warn("Low USDFC balance detected; alert-only path", {
          availableFunds: availableFunds.toString(),
          threshold: threshold.toString(),
          filBalance: filBalance.toString(),
        });
        await this.alertService.sendLowBalanceAlert({
          reason: "low_usdfc",
          availableFunds: availableFunds.toString(),
          threshold: threshold.toString(),
          filBalance: filBalance.toString(),
        });
        this.markActionTimestamp();
        return;
      }

      // Verify USDFC allowance for Payments contract (pre-check)
      const paymentsSpender = this.getPaymentsAddress();
      const currentAllowance = await this.paymentsService.allowance(paymentsSpender);

      this.logger.log("Pre-check allowance before deposit", {
        paymentsSpender,
        currentAllowance: currentAllowance.toString(),
        required: autoFundAmount.toString(),
      });

      try {
        const depositCallbacks: IDepositCallbacks = {
          onAllowanceCheck: (allowance: bigint) =>
            this.logger.log("Allowance checked", { allowance: allowance.toString() }),
          onApprovalTransaction: (tx: { hash: string }) => this.logger.log("Approval tx submitted", { hash: tx.hash }),
          onApprovalConfirmed: (receipt: { hash?: string }) =>
            this.logger.log("Approval confirmed", { txHash: receipt?.hash }),
          onDepositStarting: () => this.logger.log("Deposit starting", { amount: autoFundAmount.toString() }),
        };

        const depositTx = await this.paymentsService.deposit(autoFundAmount, undefined, depositCallbacks);

        this.logger.log("Auto-fund deposit submitted", { txHash: depositTx.hash });
        const receipt = await depositTx.wait();
        this.logger.log("Auto-fund deposit confirmed", { txHash: receipt?.hash ?? depositTx.hash });

        const postFunds = await this.paymentsService.balance();
        await this.alertService.sendFundResultAlert({
          status: "success",
          depositAmount: autoFundAmount.toString(),
          txHash: depositTx.hash,
          availableFundsBefore: availableFunds.toString(),
          availableFundsAfter: postFunds.toString(),
        });
      } catch (error) {
        this.logger.error("Auto-fund deposit failed", { error: String(error) });
        await this.alertService.sendFundResultAlert({
          status: "failed",
          depositAmount: autoFundAmount.toString(),
          availableFunds: availableFunds.toString(),
          error: String((error as any)?.message ?? error),
        });
      } finally {
        // Always mark cooldown after an action (success or failure)
        this.markActionTimestamp();
      }
    } finally {
      this.balanceCheckLock = false;
    }
  }

  // ============================================================================
  // Storage Provider Management
  // ============================================================================

  /**
   * Recursively convert BigInt values to strings for JSON serialization
   * @private
   */
  private serializeBigInt(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === "bigint") {
      return obj.toString();
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.serializeBigInt(item));
    }

    if (typeof obj === "object") {
      const serialized: any = {};
      for (const key in obj) {
        if (Object.hasOwn(obj, key)) {
          serialized[key] = this.serializeBigInt(obj[key]);
        }
      }
      return serialized;
    }

    return obj;
  }

  /**
   * Create or update provider in database
   */
  async syncProvidersToDatabase(providerInfos: ProviderInfoEx[]): Promise<void> {
    try {
      const entities = providerInfos.map((info) =>
        this.spRepository.create({
          address: info.serviceProvider as Hex,
          providerId: info.id,
          name: info.name,
          description: info.description,
          payee: info.payee,
          serviceUrl: info.products.PDP?.data.serviceURL || "Unknown",
          isActive: info.active,
          isApproved: info.isApproved,
          region: info.products.PDP?.data.location || "Unknown",
          metadata: this.serializeBigInt(info.products.PDP) || {},
        }),
      );

      await this.spRepository.upsert(entities, {
        conflictPaths: ["address"],
        skipUpdateIfNoValuesChanged: true,
      });
    } catch (error) {
      this.logger.warn(`Failed to track providers : ${error.message}`);
      throw error;
    }
  }
}
