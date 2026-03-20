import { calibration, mainnet, PDPProvider, Synapse } from "@filoz/synapse-sdk";
import type { PaymentsService } from "@filoz/synapse-sdk/payments";
import { SPRegistryService } from "@filoz/synapse-sdk/sp-registry";
import { StorageManager } from "@filoz/synapse-sdk/storage";
import { WarmStorageService } from "@filoz/synapse-sdk/warm-storage";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { toStructuredError } from "../common/logging.js";
import type { IBlockchainConfig, IConfig } from "../config/app.config.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import type { PDPProviderEx, WalletServices } from "./wallet-sdk.types.js";

@Injectable()
export class WalletSdkService implements OnModuleInit {
  private readonly logger = new Logger(WalletSdkService.name);
  private readonly blockchainConfig: IBlockchainConfig;
  private paymentsService: PaymentsService;
  private warmStorageService: WarmStorageService;
  private spRegistry: SPRegistryService;
  private storageManager: StorageManager;
  private providerCache: Map<string, PDPProviderEx> = new Map();
  private activeProviderAddresses: Set<string> = new Set();
  private approvedProviderAddresses: Set<string> = new Set();
  private providersLoadPromise: Promise<boolean> | null = null;
  private providersLoadedOnce = false;

  constructor(
    private readonly configService: ConfigService<IConfig, true>,
    @InjectRepository(StorageProvider)
    private readonly spRepository: Repository<StorageProvider>,
  ) {
    this.blockchainConfig = this.configService.get<IBlockchainConfig>("blockchain");
  }

  async onModuleInit() {
    if (process.env.DEALBOT_DISABLE_CHAIN === "true") {
      this.logger.warn({
        event: "chain_integration_disabled",
        message:
          "Chain integration disabled via DEALBOT_DISABLE_CHAIN=true; skipping Synapse initialization and provider loading.",
      });
      return;
    }
    await this.initializeServices();
    await this.ensureProvidersLoaded();
  }

  /**
   * Initialize wallet services with provider and signer
   */
  private async initializeServices(): Promise<void> {
    const account = privateKeyToAccount(this.blockchainConfig.walletPrivateKey);
    const synapse = Synapse.create({
      account,
      chain: this.blockchainConfig.network === "mainnet" ? mainnet : calibration,
      source: "dealbot",
    });

    this.warmStorageService = WarmStorageService.create({
      account,
    });
    this.spRegistry = new SPRegistryService({
      client: synapse.client,
    });
    this.paymentsService = synapse.payments;
    this.storageManager = synapse.storage;
  }

  /**
   * Load ALL registered service providers from on-chain (not just approved)
   * This allows dealbot to test all FWSS SPs, even those not yet approved
   * Only loads active, approved providers that support the PDP product
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
      this.logger.log({
        event: "providers_load_started",
        message: "Loading all service providers from sp-registry",
      });

      const approvedIds = await this.warmStorageService.getApprovedProviderIds();

      const totalProviders = await this.spRegistry.getProviderCount();

      const activeProviders = await this.spRegistry.getAllActiveProviders();
      const activeProviderIds = new Set(activeProviders.map((info) => info.id));
      const allProviderIds = Array.from({ length: Number(totalProviders) }, (_, i) => BigInt(i + 1));
      const inactiveProviderIds = allProviderIds.filter((id) => !activeProviderIds.has(id));

      const providerInfos: PDPProvider[] = [...activeProviders];
      if (inactiveProviderIds.length > 0) {
        // Fetch inactive providers individually — some may lack a PDP product
        // (empty capabilities), which causes getPDPProvidersByIds to throw.
        for (const id of inactiveProviderIds) {
          try {
            const provider = await this.spRegistry.getProvider({ providerId: id });
            if (provider) {
              providerInfos.push(provider);
            }
          } catch {
            this.logger.warn({
              event: "inactive_provider_skip",
              message: `Skipping inactive provider ${id} — no PDP product or invalid data`,
              providerId: id,
            });
          }
        }
      }

      const validProviders = providerInfos.filter((info) => !!info);

      this.providerCache.clear();
      this.activeProviderAddresses.clear();
      this.approvedProviderAddresses.clear();
      const extendedProviders = validProviders.map((info) => {
        const supportsIpniIpfs = !!info.pdp.ipniIpfs;
        const isApproved = approvedIds.includes(info.id);

        // Log providers that are otherwise active but don't support IPNI
        if (!supportsIpniIpfs) {
          this.logger.warn({
            event: "provider_missing_ipni_support",
            message: "Active PDP provider does not support ipniIpfs and will be excluded from deals",
            providerId: info.id,
            providerName: info.name,
            providerAddress: info.serviceProvider,
          });
        }

        // select approved, active providers
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

      this.logger.log({
        event: "providers_load_completed",
        message: "Loaded providers from on-chain",
        totalProviders: this.providerCache.size,
        testingProviders: this.activeProviderAddresses.size,
        approvedProviders: this.approvedProviderAddresses.size,
      });
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
   * Ensure wallet has sufficient allowances for operations
   */
  async ensureWalletAllowances(): Promise<void> {
    const STORAGE_SIZE_GB = 100n;
    const { costs, transaction } = await this.storageManager.prepare({
      dataSize: STORAGE_SIZE_GB * 1024n * 1024n * 1024n,
    });

    this.logger.log({
      event: "wallet_status_check_completed",
      depositAmount: transaction?.depositAmount,
      includesApproval: transaction?.includesApproval,
      costs,
    });

    if (transaction) {
      this.logger.log({
        event: "wallet_deposit_started",
        depositAmount: transaction.depositAmount.toString(),
        includesApproval: transaction?.includesApproval,
        costs,
      });

      const { hash } = await transaction.execute();

      this.logger.log({
        event: "wallet_deposit_succeeded",
        transactionHash: hash,
        depositAmount: transaction.depositAmount.toString(),
        includesApproval: transaction.includesApproval,
        costs,
      });
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
          this.logger.warn({
            event: "duplicate_provider_address",
            message: "Duplicate provider address detected",
            address,
            existingProviderId: existing.id,
            newProviderId: info.id,
          });
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
          this.logger.warn({
            event: "duplicate_provider_addresses_resolved",
            message: "Duplicate provider addresses detected; replaced inactive entries with active ones",
            details: formatDetails(resolvedOnly),
          });
        }
      }

      const entities = Array.from(dedupedProviders.values()).map((info) =>
        this.spRepository.create({
          address: info.serviceProvider as Hex,
          providerId: info.id,
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
