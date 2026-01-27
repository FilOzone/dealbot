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
import type { Repository } from "typeorm";
import type { Hex } from "viem";
import { DEV_TAG } from "../common/constants.js";
import type { IBlockchainConfig, IConfig } from "../config/app.config.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
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
  private rpcProvider: JsonRpcProvider;
  private providerCache: Map<string, ProviderInfoEx> = new Map();
  private activeProviderAddresses: Set<string> = new Set();
  private approvedProviderAddresses: Set<string> = new Set();

  constructor(
    private readonly configService: ConfigService<IConfig, true>,
    @InjectRepository(StorageProvider)
    private readonly spRepository: Repository<StorageProvider>,
  ) {
    this.blockchainConfig = this.configService.get<IBlockchainConfig>("blockchain");
  }

  async onModuleInit() {
    if (process.env.DEALBOT_DISABLE_CHAIN === "true") {
      this.logger.warn(
        "Chain integration disabled via DEALBOT_DISABLE_CHAIN=true; skipping Synapse initialization and provider loading.",
      );
      return;
    }
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

    this.rpcProvider = new JsonRpcProvider(RPC_URLS[this.blockchainConfig.network].http);
    this.warmStorageService = await WarmStorageService.create(this.rpcProvider, warmStorageAddress);
    this.spRegistry = new SPRegistryService(
      this.rpcProvider,
      this.warmStorageService.getServiceProviderRegistryAddress(),
    );
    this.paymentsService = synapse.payments;
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

      const totalProviders = await this.spRegistry.getProviderCount();

      const activeProviders = await this.spRegistry.getAllActiveProviders();
      const activeProviderIds = new Set(activeProviders.map((info) => Number(info.id)));
      const allProviderIds = Array.from({ length: totalProviders }, (_, i) => i + 1);
      const inactiveProviderIds = allProviderIds.filter((id) => !activeProviderIds.has(id));

      const providerInfos: ProviderInfo[] = [...activeProviders];
      if (inactiveProviderIds.length > 0) {
        if (inactiveProviderIds.length > 50) {
          // batch get remaining providers if we have more than 50 inactive providers. This is not currently happening, but may in the future.
          const batchSize = 50;
          const batches = Math.ceil(inactiveProviderIds.length / batchSize);
          for (let i = 0; i < batches; i++) {
            const start = i * batchSize;
            const batch = inactiveProviderIds.slice(start, start + batchSize);
            const providerBatch = await this.spRegistry.getProviders(batch);
            providerInfos.push(...providerBatch);
          }
        } else {
          providerInfos.push(...(await this.spRegistry.getProviders(inactiveProviderIds)));
        }
      }

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
   * Get wallet balances in base units.
   * USDFC is the available balance in the Filecoin Pay contract (funds minus lockups).
   */
  async getWalletBalances(): Promise<{ usdfc: bigint; fil: bigint }> {
    const accountInfo = await this.paymentsService.accountInfo();
    const filBalance = await this.rpcProvider.getBalance(this.blockchainConfig.walletAddress);
    return {
      usdfc: accountInfo.availableFunds,
      fil: filBalance,
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
    return CONTRACT_ADDRESSES.WARM_STORAGE[this.blockchainConfig.network];
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
      const dedupedProviders = new Map<string, ProviderInfoEx>();
      const duplicatesByAddress = new Map<string, Set<number>>();
      const conflictAddresses = new Set<string>();
      const resolvedInactiveAddresses = new Set<string>();

      for (const info of providerInfos) {
        const address = info.serviceProvider;
        const existing = dedupedProviders.get(address);
        if (existing) {
          this.logger.warn(`Duplicate provider address ${address} (providerIds: ${existing.id}, ${info.id})`);
          let ids = duplicatesByAddress.get(address);
          if (!ids) {
            ids = new Set<number>();
            duplicatesByAddress.set(address, ids);
            ids.add(existing.id);
          }
          ids.add(info.id);

          if (existing.active !== info.active) {
            if (info.active && !existing.active) {
              resolvedInactiveAddresses.add(address);
              dedupedProviders.set(address, info);
            }
            continue;
          }

          conflictAddresses.add(address);
          if (info.id > existing.id) {
            dedupedProviders.set(address, info);
          }
          continue;
        }
        dedupedProviders.set(address, info);
      }

      if (duplicatesByAddress.size > 0) {
        const formatDetails = (addresses: Set<string>) =>
          Array.from(addresses).map((address) => {
            const ids = duplicatesByAddress.get(address) ?? new Set<number>();
            return `${address} (providerIds: ${Array.from(ids).join(", ")})`;
          });

        const resolvedOnly = new Set(
          Array.from(resolvedInactiveAddresses).filter((address) => !conflictAddresses.has(address)),
        );

        if (conflictAddresses.size > 0) {
          // if there is no difference between active/inactive, we keep the highest providerId.
          this.logger.error(
            `Duplicate provider addresses without active/inactive resolution; keeping highest providerId entries: ${formatDetails(conflictAddresses).join("; ")}`,
          );
        }

        if (resolvedOnly.size > 0) {
          // if there is a difference between active/inactive, we replace the inactive entries with the active ones.
          this.logger.warn(
            `Duplicate provider addresses detected; replaced inactive entries with active ones: ${formatDetails(resolvedOnly).join("; ")}`,
          );
        }
      }

      const entities = Array.from(dedupedProviders.values()).map((info) =>
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
