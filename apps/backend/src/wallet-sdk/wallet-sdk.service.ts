import {
  mainnet,
  calibration,
  Synapse,
  TIME_CONSTANTS,
  PDPProvider,
} from "@filoz/synapse-sdk";
import type { PaymentsService } from "@filoz/synapse-sdk/payments";
import type { ProviderInfo } from "@filoz/synapse-sdk/sp-registry";
import { WarmStorageService } from "@filoz/synapse-sdk/warm-storage";
import { SPRegistryService } from "@filoz/synapse-sdk/sp-registry";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import type { Hex } from "viem";
import { DEV_TAG } from "../common/constants.js";
import { toStructuredError } from "../common/logging.js";
import type { IBlockchainConfig, IConfig } from "../config/app.config.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import type {
  FundDepositLog,
  PDPProviderEx,
  ServiceApprovalLog,
  StorageRequirements,
  TransactionLog,
  WalletServices,
  WalletStatusLog,
} from "./wallet-sdk.types.js";
import { waitForTransactionReceipt } from "viem/actions";
import { privateKeyToAccount } from "viem/accounts";
import type { Client } from "viem";

@Injectable()
export class WalletSdkService implements OnModuleInit {
  private readonly logger = new Logger(WalletSdkService.name);
  private readonly blockchainConfig: IBlockchainConfig;
  private paymentsService: PaymentsService;
  private warmStorageService: WarmStorageService;
  private spRegistry: SPRegistryService;
  private providerCache: Map<string, PDPProviderEx> = new Map();
  private activeProviderAddresses: Set<string> = new Set();
  private approvedProviderAddresses: Set<string> = new Set();
  private providersLoadPromise: Promise<boolean> | null = null;
  private providersLoadedOnce = false;
  private synapseClient: Client | null = null;

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
    await this.ensureProvidersLoaded();
  }

  /**
   * Initialize wallet services with provider and signer
   */
  private async initializeServices(): Promise<void> {
    const account = privateKeyToAccount(this.blockchainConfig.walletPrivateKey)
    const synapse = await Synapse.create({
      account,
      chain: this.blockchainConfig.network === 'mainnet' ? mainnet : calibration,
    });

    this.warmStorageService = await WarmStorageService.create({
      account,
    })
    // this.rpcProvider, warmStorageAddress);
    this.spRegistry = new SPRegistryService({
      client: synapse.client
    });
    this.paymentsService = synapse.payments;
    this.synapseClient = synapse.client;
  }

  /**
   * Load ALL registered service providers from on-chain (not just approved)
   * This allows dealbot to test all FWSS SPs, even those not yet approved
   * Only loads active providers that support the PDP product and excludes dev-tagged providers
   */
  async loadProviders(): Promise<void> {
    if (this.providersLoadPromise) {
      await this.providersLoadPromise;
      return;
    }

    this.providersLoadPromise = this.loadProvidersInternal();
    try {
      const success = await this.providersLoadPromise;
      if (success) {
        this.providersLoadedOnce = true;
      }
    } finally {
      this.providersLoadPromise = null;
    }
  }

  async ensureProvidersLoaded(): Promise<void> {
    if (this.providersLoadedOnce) {
      return;
    }
    await this.loadProviders();
  }

  private async loadProvidersInternal(): Promise<boolean> {
    try {
      this.logger.log("Loading all service providers from sp-registry...");

      const approvedIds = await this.warmStorageService.getApprovedProviderIds();

      const totalProviders = await this.spRegistry.getProviderCount();

      const activeProviders = await this.spRegistry.getAllActiveProviders();
      const activeProviderIds = new Set(activeProviders.map((info) => info.id));
      const allProviderIds = Array.from({ length: Number(totalProviders) }, (_, i) => BigInt(i + 1));
      const inactiveProviderIds = allProviderIds.filter((id) => !activeProviderIds.has(id));

      const providerInfos: PDPProvider[] = [...activeProviders];
      if (inactiveProviderIds.length > 0) {
        if (inactiveProviderIds.length > 50) {
          // batch get remaining providers if we have more than 50 inactive providers. This is not currently happening, but may in the future.
          const batchSize = 50;
          const batches = Math.ceil(inactiveProviderIds.length / batchSize);
          for (let i = 0; i < batches; i++) {
            const start = i * batchSize;
            const batch = inactiveProviderIds.slice(start, start + batchSize);
            const providerBatch = await this.spRegistry.getProviders({
              providerIds: batch,
            });
            providerInfos.push(...providerBatch);
          }
        } else {
          providerInfos.push(...(await this.spRegistry.getProviders({
            providerIds: inactiveProviderIds,
          })));
        }
      }

      const validProviders = providerInfos.filter((info) => !!info);

      this.providerCache.clear();
      this.activeProviderAddresses.clear();
      this.approvedProviderAddresses.clear();
      const extendedProviders = validProviders.map((info) => {
        // In order to support ipniIpfs, the provider must have PDP product
        const supportsIpniIpfs = !!info.pdp.ipniIpfs;
        const isApproved = approvedIds.includes(info.id);

        // Log providers that are otherwise active but don't support IPNI
        if (!supportsIpniIpfs) {
          this.logger.warn({
            event: "provider_missing_ipni_support",
            message: `Active PDP provider ${info.id} does not support ipniIpfs and will be excluded from deals`,
            providerId: info.id,
            providerAddress: info.serviceProvider,
          });
        }

        // select approved providers which are not dev tagged
        if (info.isActive) this.activeProviderAddresses.add(info.serviceProvider);
        if (isApproved && info.isActive) this.approvedProviderAddresses.add(info.serviceProvider);
        this.providerCache.set(info.serviceProvider, {
          ...info,
          isApproved,
        });

        return {
          ...info,
          isApproved,
        };
      });

      this.syncProvidersToDatabase(extendedProviders).catch((err) =>
        this.logger.error({
          event: "providers_sync_to_db_failed",
          message: "Failed to sync providers to DB",
          error: toStructuredError(err),
        }),
      );

      this.logger.log(
        `Loaded ${this.providerCache.size} providers from on-chain (${this.activeProviderAddresses.size} testing) (${this.approvedProviderAddresses.size} approved)`,
      );
      return true;
    } catch (error) {
      this.logger.error({
        event: "providers_load_failed",
        message: "Failed to load registered providers from on-chain",
        error: toStructuredError(error),
      });
      // Fallback to empty array, let the application handle this gracefully
      this.providerCache.clear();
      this.activeProviderAddresses.clear();
      this.approvedProviderAddresses.clear();
      return false;
    }
  }

  /**
   * Get count of approved providers
   */
  getApprovedProvidersCount(): number {
    return this.approvedProviderAddresses.size;
  }

  /**
   * Get count of all active providers supporting ipniIpfs
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
  getApprovedProviders(): PDPProviderEx[] {
    const approvedProviders: PDPProviderEx[] = [];

    for (const address of this.approvedProviderAddresses) {
      const provider = this.providerCache.get(address);
      if (provider) approvedProviders.push(provider);
    }

    return approvedProviders;
  }

  /**
   * Get all active providers
   */
  getAllActiveProviders(): PDPProviderEx[] {
    const activeProviders: PDPProviderEx[] = [];

    for (const address of this.activeProviderAddresses) {
      const provider = this.providerCache.get(address);
      if (provider) activeProviders.push(provider);
    }

    return activeProviders;
  }

  /**
   * Get testing providers
   */
  getTestingProviders(): PDPProviderEx[] {
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
    const filBalance = await this.paymentsService.walletBalance();
    return {
      usdfc: accountInfo.availableFunds,
      fil: filBalance,
    };
  }

  /**
   * Get approved provider info by address
   */
  getProviderInfo(address: string): PDPProviderEx | undefined {
    return this.providerCache.get(address);
  }

  /**
   * Calculate storage requirements including costs and allowances
   */
  async calculateStorageRequirements(): Promise<StorageRequirements> {
    const providerCount = this.getTestingProvidersCount();

    const STORAGE_SIZE_GB = 100n;
    const APPROVAL_DURATION_MONTHS = 6n;
    const datasetCreationFees = this.blockchainConfig.checkDatasetCreationFees
      ? this.calculateDatasetCreationFees(providerCount)
      : 0n;

    const [accountInfo, storageCheck, serviceApprovals] = await Promise.all([
      this.paymentsService.accountInfo(),
      this.warmStorageService.checkAllowanceForStorage({
        sizeInBytes: STORAGE_SIZE_GB * 1024n * 1024n * 1024n,
        withCDN: true,
      }),
      this.paymentsService.serviceApproval(),
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
    const minDataSetPerSP = 1n; // single dataset per storage provider
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

    this.logger.log({
      event: "wallet_status_check_completed",
      ...logData,
    });
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

    this.logger.log({
      event: "wallet_deposit_started",
      ...depositLog,
    });

    const hash = await this.paymentsService.deposit({
      amount: depositAmount,
    });
    await waitForTransactionReceipt(this.synapseClient!, { hash })

    const successLog: TransactionLog = {
      transactionHash: hash,
      depositAmount: depositAmount.toString(),
    };

    this.logger.log({
      event: "wallet_deposit_succeeded",
      ...successLog,
    });
  }

  /**
   * Approve storage service with required allowances
   */
  async approveStorageService(requirements: StorageRequirements): Promise<void> {
    const approvalLog: ServiceApprovalLog = {
      rateAllowance: "Maximum of uint256",
      lockupAllowance: "Maximum of uint256",
      durationMonths: Number(requirements.approvalDuration / TIME_CONSTANTS.EPOCHS_PER_MONTH),
    };

    this.logger.log({
      event: "storage_service_approval_started",
      ...approvalLog,
    });

    const hash = await this.paymentsService.approveService({
      maxLockupPeriod: requirements.approvalDuration,
    })
    await waitForTransactionReceipt(this.synapseClient!, { hash })

    const successLog: TransactionLog = {
      transactionHash: hash,
    };

    this.logger.log({
      event: "storage_service_approval_succeeded",
      ...successLog,
    });
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
  async syncProvidersToDatabase(providerInfos: PDPProviderEx[]): Promise<void> {
    try {
      const dedupedProviders = new Map<string, PDPProviderEx>();
      const duplicatesByAddress = new Map<string, Set<bigint>>();
      const conflictAddresses = new Set<string>();
      const resolvedInactiveAddresses = new Set<string>();

      for (const info of providerInfos) {
        const address = info.serviceProvider;
        const existing = dedupedProviders.get(address);
        if (existing) {
          this.logger.warn(`Duplicate provider address ${address} (providerIds: ${existing.id}, ${info.id})`);
          let ids = duplicatesByAddress.get(address);
          if (!ids) {
            ids = new Set<bigint>();
            duplicatesByAddress.set(address, ids);
            ids.add(existing.id);
          }
          ids.add(info.id);

          if (existing.isActive !== info.isActive) {
            if (info.isActive && !existing.isActive) {
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
            const ids = duplicatesByAddress.get(address) ?? new Set<bigint>();
            return `${address} (providerIds: ${Array.from(ids).join(", ")})`;
          });

        const resolvedOnly = new Set(
          Array.from(resolvedInactiveAddresses).filter((address) => !conflictAddresses.has(address)),
        );

        if (conflictAddresses.size > 0) {
          // if there is no difference between active/inactive, we keep the highest providerId.
          this.logger.error({
            event: "duplicate_provider_addresses_unresolved",
            message:
              "Duplicate provider addresses without active/inactive resolution; keeping highest providerId entries",
            details: formatDetails(conflictAddresses),
          });
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
          providerId: Number(info.id),
          name: info.name,
          description: info.description,
          payee: info.payee,
          serviceUrl: info.pdp.serviceURL,
          isActive: info.isActive,
          isApproved: info.isApproved,
          location: info.pdp.location,
          metadata: this.serializeBigInt(info.pdp) || {},
        }),
      );

      await this.spRepository.upsert(entities, {
        conflictPaths: ["address"],
        skipUpdateIfNoValuesChanged: true,
      });
    } catch (error) {
      this.logger.warn({
        event: "track_providers_failed",
        message: "Failed to track providers",
        error: toStructuredError(error),
      });
      throw error;
    }
  }
}
