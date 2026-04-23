import { PDPProvider } from "@filoz/synapse-sdk";
import type { PaymentsService } from "@filoz/synapse-sdk/payments";
import { SPRegistryService } from "@filoz/synapse-sdk/sp-registry";
import { StorageManager } from "@filoz/synapse-sdk/storage";
import { WarmStorageService } from "@filoz/synapse-sdk/warm-storage";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import type { Chain, Client, Hex, Transport } from "viem";
import { toStructuredError } from "../common/logging.js";
import { createSynapseFromConfig } from "../common/synapse-factory.js";
import type { Network } from "../common/types.js";
import type { IConfig, INetworkConfig } from "../config/types.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import type { PDPProviderEx, WalletServices } from "./wallet-sdk.types.js";

interface NetworkState {
  config: INetworkConfig;
  paymentsService: PaymentsService;
  warmStorageService: WarmStorageService;
  spRegistry: SPRegistryService;
  storageManager: StorageManager;
  synapseClient: Client<Transport, Chain>;
  isSessionKeyMode: boolean;
  providerCache: Map<string, PDPProviderEx>;
  activeProviderAddresses: Set<string>;
  approvedProviderAddresses: Set<string>;
  providersLoadPromise: Promise<boolean> | null;
  providersLoadedOnce: boolean;
}

@Injectable()
export class WalletSdkService implements OnModuleInit {
  private readonly logger = new Logger(WalletSdkService.name);
  private readonly networkStates: Map<Network, NetworkState> = new Map();

  constructor(
    private readonly configService: ConfigService<IConfig, true>,
    @InjectRepository(StorageProvider)
    private readonly spRepository: Repository<StorageProvider>,
  ) {}

  async onModuleInit() {
    if (process.env.DEALBOT_DISABLE_CHAIN === "true") {
      this.logger.warn({
        event: "chain_integration_disabled",
        message:
          "Chain integration disabled via DEALBOT_DISABLE_CHAIN=true; skipping Synapse initialization and provider loading.",
      });
      return;
    }
    this.logger.log({
      event: "env_log",
      message: "Environment variables",
      networks: this.configService.get("networks"),
    });
    const activeNetworks = this.configService.get("activeNetworks");
    for (const network of activeNetworks) {
      await this.initializeServicesForNetwork(network);
      await this.ensureProvidersLoaded(network);
    }
  }

  /**
   * Initialize wallet services for a specific network.
   */
  private async initializeServicesForNetwork(network: Network): Promise<void> {
    const networkConfig = this.configService.get("networks")[network];
    const { synapse, isSessionKeyMode } = await createSynapseFromConfig(networkConfig);

    this.logger.log({
      event: "wallet_sdk_initialized",
      message: isSessionKeyMode
        ? "Initialized wallet SDK services (session key mode)"
        : "Initialized wallet SDK services",
      network,
      walletAddress: networkConfig.walletAddress,
    });

    this.networkStates.set(network, {
      config: networkConfig,
      paymentsService: synapse.payments,
      warmStorageService: new WarmStorageService({ client: synapse.client }),
      spRegistry: new SPRegistryService({ client: synapse.client }),
      storageManager: synapse.storage,
      synapseClient: synapse.client,
      isSessionKeyMode,
      providerCache: new Map(),
      activeProviderAddresses: new Set(),
      approvedProviderAddresses: new Set(),
      providersLoadPromise: null,
      providersLoadedOnce: false,
    });
  }

  private getNetworkState(network: Network): NetworkState {
    const target = network;
    const state = this.networkStates.get(target);
    if (!state) {
      throw new Error(`No initialized state for network "${target}". Ensure NETWORKS includes this network.`);
    }
    return state;
  }

  /**
   * Load ALL registered service providers from on-chain (not just approved)
   * This allows dealbot to test all FWSS SPs, even those not yet approved
   * Only loads active, approved providers that support the PDP product
   */
  async loadProviders(network: Network): Promise<void> {
    const state = this.getNetworkState(network);
    if (state.providersLoadPromise) {
      await state.providersLoadPromise;
      return;
    }

    state.providersLoadPromise = this.loadProvidersInternal(network);
    try {
      const success = await state.providersLoadPromise;
      if (success) {
        state.providersLoadedOnce = true;
      }
    } finally {
      state.providersLoadPromise = null;
    }
  }

  async ensureProvidersLoaded(network: Network): Promise<void> {
    const state = this.getNetworkState(network);
    if (state.providersLoadedOnce) {
      return;
    }
    await this.loadProviders(network);
  }

  private async loadProvidersInternal(network: Network): Promise<boolean> {
    const state = this.getNetworkState(network);
    try {
      this.logger.log({
        event: "providers_load_started",
        message: "Loading all service providers from sp-registry",
        network,
      });

      const approvedIds = await state.warmStorageService.getApprovedProviderIds();

      const totalProviders = await state.spRegistry.getProviderCount();

      const activeProviders = await state.spRegistry.getAllActiveProviders();
      const activeProviderIds = new Set(activeProviders.map((info) => info.id));
      const allProviderIds = Array.from({ length: Number(totalProviders) }, (_, i) => BigInt(i + 1));
      const inactiveProviderIds = allProviderIds.filter((id) => !activeProviderIds.has(id));

      const providerInfos: PDPProvider[] = [...activeProviders];
      if (inactiveProviderIds.length > 0) {
        // Fetch inactive providers individually — some may lack a PDP product
        // (empty capabilities), which causes getPDPProvidersByIds to throw.
        for (const id of inactiveProviderIds) {
          try {
            const provider = await state.spRegistry.getProvider({ providerId: id });
            if (provider) {
              providerInfos.push(provider);
            }
          } catch {
            this.logger.warn({
              event: "inactive_provider_skip",
              message: `Skipping inactive provider ${id} — no PDP product or invalid data`,
              providerId: id,
              network,
            });
          }
        }
      }

      const validProviders = providerInfos.filter((info) => !!info);

      state.providerCache.clear();
      state.activeProviderAddresses.clear();
      state.approvedProviderAddresses.clear();
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
            network,
          });
        }

        // select approved, active providers
        if (info.isActive) state.activeProviderAddresses.add(info.serviceProvider);
        if (isApproved && info.isActive) state.approvedProviderAddresses.add(info.serviceProvider);
        state.providerCache.set(info.serviceProvider, {
          ...info,
          isApproved,
        });

        return {
          ...info,
          isApproved,
        };
      });

      this.syncProvidersToDatabase(extendedProviders, network).catch((err) =>
        this.logger.error({
          event: "providers_sync_to_db_failed",
          message: "Failed to sync providers to DB",
          network,
          error: toStructuredError(err),
        }),
      );

      this.logger.log({
        event: "providers_load_completed",
        message: "Loaded providers from on-chain",
        network,
        totalProviders: state.providerCache.size,
        testingProviders: state.activeProviderAddresses.size,
        approvedProviders: state.approvedProviderAddresses.size,
      });
      return true;
    } catch (error) {
      this.logger.error({
        event: "providers_load_failed",
        message: "Failed to load registered providers from on-chain",
        network,
        error: toStructuredError(error),
      });
      // Fallback to empty array, let the application handle this gracefully
      state.providerCache.clear();
      state.activeProviderAddresses.clear();
      state.approvedProviderAddresses.clear();
      return false;
    }
  }

  /**
   * Get count of approved providers
   */
  getApprovedProvidersCount(network: Network): number {
    return this.getNetworkState(network).approvedProviderAddresses.size;
  }

  /**
   * Get count of all active providers supporting ipniIpfs
   */
  getAllActiveProvidersCount(network: Network): number {
    return this.getNetworkState(network).activeProviderAddresses.size;
  }

  /**
   * Get count of testing providers
   */
  getTestingProvidersCount(network: Network): number {
    const state = this.getNetworkState(network);
    return state.config.useOnlyApprovedProviders
      ? state.approvedProviderAddresses.size
      : state.activeProviderAddresses.size;
  }

  /**
   * Get approved providers
   */
  getApprovedProviders(network: Network): PDPProviderEx[] {
    const state = this.getNetworkState(network);
    const approvedProviders: PDPProviderEx[] = [];

    for (const address of state.approvedProviderAddresses) {
      const provider = state.providerCache.get(address);
      if (provider) approvedProviders.push(provider);
    }

    return approvedProviders;
  }

  /**
   * Get all active providers
   */
  getAllActiveProviders(network: Network): PDPProviderEx[] {
    const state = this.getNetworkState(network);
    const activeProviders: PDPProviderEx[] = [];

    for (const address of state.activeProviderAddresses) {
      const provider = state.providerCache.get(address);
      if (provider) activeProviders.push(provider);
    }

    return activeProviders;
  }

  /**
   * Get testing providers
   */
  getTestingProviders(network: Network): PDPProviderEx[] {
    const state = this.getNetworkState(network);
    return state.config.useOnlyApprovedProviders
      ? this.getApprovedProviders(network)
      : this.getAllActiveProviders(network);
  }

  /**
   * Get wallet services (now returns instance variables)
   */
  getWalletServices(network: Network): WalletServices {
    const state = this.getNetworkState(network);
    return {
      paymentsService: state.paymentsService,
      warmStorageService: state.warmStorageService,
    };
  }

  /**
   * Get wallet balances in base units.
   * USDFC is the available balance in the Filecoin Pay contract (funds minus lockups).
   */
  async getWalletBalances(network: Network): Promise<{ usdfc: bigint; fil: bigint }> {
    const state = this.getNetworkState(network);
    const accountInfo = await state.paymentsService.accountInfo();
    const filBalance = await state.paymentsService.walletBalance();
    return {
      usdfc: accountInfo.availableFunds,
      fil: filBalance,
    };
  }

  /**
   * Get provider info by address for a specific network.
   */
  getProviderInfo(address: string, network: Network): PDPProviderEx | undefined {
    return this.getNetworkState(network).providerCache.get(address);
  }

  /**
   * Ensure wallet has sufficient allowances for operations.
   * Skipped in session key mode, deposits and operator approvals must be
   * done separately via the Safe multisig UI.
   */
  async ensureWalletAllowances(network: Network): Promise<void> {
    const state = this.getNetworkState(network);
    if (state.isSessionKeyMode) {
      const { getUploadCosts } = await import("@filoz/synapse-core/warm-storage");
      const costs = await getUploadCosts(state.synapseClient, {
        clientAddress: state.config.walletAddress as Hex,
        dataSize: 100n * 1024n * 1024n * 1024n,
      });

      if (costs.ready) {
        this.logger.log({
          event: "wallet_status_check_completed",
          message: "Session key mode: account is funded and approved",
          network,
          costs: this.serializeBigInt(costs),
        });
      } else {
        this.logger.error({
          event: "wallet_not_ready",
          message:
            "Session key mode: account is NOT ready. Deposit USDFC and/or approve FWSS operator via the Safe multisig.",
          network,
          depositNeeded: costs.depositNeeded.toString(),
          needsApproval: costs.needsFwssMaxApproval,
          costs: this.serializeBigInt(costs),
        });
        throw new Error(
          `Session key mode: wallet not ready (depositNeeded=${costs.depositNeeded.toString()}, needsFwssMaxApproval=${costs.needsFwssMaxApproval})`,
        );
      }
      return;
    }
    const STORAGE_SIZE_GB = 100n;
    const { costs, transaction } = await state.storageManager.prepare({
      dataSize: STORAGE_SIZE_GB * 1024n * 1024n * 1024n,
    });

    this.logger.log({
      event: "wallet_status_check_completed",
      network,
      depositAmount: transaction?.depositAmount,
      includesApproval: transaction?.includesApproval,
      costs,
    });

    if (transaction) {
      this.logger.log({
        event: "wallet_deposit_started",
        network,
        depositAmount: transaction.depositAmount.toString(),
        includesApproval: transaction?.includesApproval,
        costs,
      });

      const { hash } = await transaction.execute();

      this.logger.log({
        event: "wallet_deposit_succeeded",
        network,
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
   * Create or update provider in database with network scoping.
   */
  async syncProvidersToDatabase(providerInfos: PDPProviderEx[], network: Network): Promise<void> {
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
            network,
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
            network,
            details: formatDetails(conflictAddresses),
          });
        }

        if (resolvedOnly.size > 0) {
          // if there is a difference between active/inactive, we replace the inactive entries with the active ones.
          this.logger.warn({
            event: "duplicate_provider_addresses_resolved",
            message: "Duplicate provider addresses detected; replaced inactive entries with active ones",
            network,
            details: formatDetails(resolvedOnly),
          });
        }
      }

      const entities = Array.from(dedupedProviders.values()).map((info) =>
        this.spRepository.create({
          address: info.serviceProvider as Hex,
          network,
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
        conflictPaths: ["address", "network"],
        skipUpdateIfNoValuesChanged: true,
      });
    } catch (error) {
      this.logger.warn({
        event: "track_providers_failed",
        message: "Failed to track providers",
        network,
        error: toStructuredError(error),
      });
      throw error;
    }
  }
}
