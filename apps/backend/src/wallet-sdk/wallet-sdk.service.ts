import { PDPProvider, Synapse } from "@filoz/synapse-sdk";
import type { PaymentsService } from "@filoz/synapse-sdk/payments";
import { SPRegistryService } from "@filoz/synapse-sdk/sp-registry";
import { StorageManager } from "@filoz/synapse-sdk/storage";
import { WarmStorageService } from "@filoz/synapse-sdk/warm-storage";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Account, Chain, Client, Transport } from "viem";
import { DEV_TAG } from "../common/constants.js";
import { toStructuredError } from "../common/logging.js";
import { createSynapseFromConfig } from "../common/synapse-factory.js";
import type { Network } from "../common/types.js";
import type { IConfig, INetworkConfig } from "../config/index.js";
import { StorageProviderRepository } from "../providers/repositories/storage-provider.repository.js";
import type { PDPProviderEx, WalletServices } from "./wallet-sdk.types.js";

export type SynapseViemClient = Client<Transport, Chain, Account>;

interface NetworkState {
  config: INetworkConfig;
  synapse: Synapse;
  paymentsService: PaymentsService;
  warmStorageService: WarmStorageService;
  spRegistry: SPRegistryService;
  storageManager: StorageManager;
  synapseClient: SynapseViemClient;
  isSessionKeyMode: boolean;
  providersLoadPromise: Promise<boolean> | null;
}

@Injectable()
export class WalletSdkService implements OnModuleInit {
  private readonly logger = new Logger(WalletSdkService.name);
  private readonly networkStates: Map<Network, NetworkState> = new Map();

  constructor(
    private readonly configService: ConfigService<IConfig, true>,
    private readonly storageProviderRepository: StorageProviderRepository,
  ) {}

  async onModuleInit() {
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
      synapse,
      isSessionKeyMode,
      config: networkConfig,
      paymentsService: synapse.payments,
      warmStorageService: new WarmStorageService({ client: synapse.client }),
      spRegistry: new SPRegistryService({ client: synapse.client }),
      storageManager: synapse.storage,
      synapseClient: synapse.client,
      providersLoadPromise: null,
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
  async loadProviders(network: Network): Promise<boolean> {
    const state = this.getNetworkState(network);
    if (state.providersLoadPromise) {
      return state.providersLoadPromise;
    }

    state.providersLoadPromise = this.loadProvidersInternal(network);
    try {
      return await state.providersLoadPromise;
    } finally {
      state.providersLoadPromise = null;
    }
  }

  async ensureProvidersLoaded(network: Network): Promise<void> {
    const count = await this.storageProviderRepository.countByNetwork(network);
    if (count > 0) {
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
            });
          }
        }
      }

      const validProviders = providerInfos.filter((info) => {
        if (!info) return false;
        if (this.isDevProvider(info)) {
          this.logger.log({
            event: "provider_skipped_dev",
            message: "Skipping dev provider",
            providerId: info.id,
            providerName: info.name,
            network,
          });
          return false;
        }
        return true;
      });

      const extendedProviders: PDPProviderEx[] = validProviders.map((info) => {
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

        return {
          ...info,
          isApproved,
        };
      });

      try {
        await this.storageProviderRepository.upsertFromRegistry(extendedProviders, network);
      } catch (err) {
        this.logger.error({
          event: "providers_sync_to_db_failed",
          message: "Failed to sync providers to DB",
          error: toStructuredError(err),
        });
        throw err;
      }

      this.logger.log({
        event: "providers_load_completed",
        message: "Loaded providers from on-chain",
        network,
        totalProviders: extendedProviders.length,
        testingProviders: extendedProviders.filter((p) => p.isActive).length,
        approvedProviders: extendedProviders.filter((p) => p.isApproved).length,
      });
      return true;
    } catch (error) {
      this.logger.error({
        event: "providers_load_failed",
        message: "Failed to load registered providers from on-chain",
        error: toStructuredError(error),
        network,
      });
      return false;
    }
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
   * Get the underlying Synapse-SDK viem client.
   *
   * Used by features that need to call low-level Synapse helpers (e.g. `pullPieces`
   * from `@filoz/synapse-core/sp`) which require a viem `Client<Transport, Chain, Account>`.
   * Returns `null` when the client has not been initialized yet.
   */
  getSynapseClient(network: Network): SynapseViemClient | null {
    return (this.getNetworkState(network).synapseClient as SynapseViemClient | null) ?? null;
  }

  getSynapse(network: Network): Synapse {
    return this.getNetworkState(network).synapse;
  }

  /**
   * Returns the initialized Synapse for a network, or `undefined` when the
   * network has no initialized state (the network isn't active).
   * Unlike {@link getSynapse}, this never throws, so callers can
   * fall back to on-demand creation.
   */
  tryGetSynapse(network: Network): Synapse | undefined {
    return this.networkStates.get(network)?.synapse;
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
        clientAddress: state.config.walletAddress as `0x${string}`,
        dataSize: 100n * 1024n * 1024n * 1024n,
      });

      if (costs.ready) {
        this.logger.log({
          event: "wallet_status_check_completed",
          message: "Session key mode: account is funded and approved",
          costs: this.serializeBigInt(costs),
          network,
        });
      } else {
        this.logger.error({
          event: "wallet_not_ready",
          message:
            "Session key mode: account is NOT ready. Deposit USDFC and/or approve FWSS operator via the Safe multisig.",
          depositNeeded: costs.depositNeeded.toString(),
          needsApproval: costs.needsFwssMaxApproval,
          costs: this.serializeBigInt(costs),
          network,
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
      depositAmount: transaction?.depositAmount,
      includesApproval: transaction?.includesApproval,
      costs,
      network,
    });

    if (transaction) {
      this.logger.log({
        event: "wallet_deposit_started",
        depositAmount: transaction.depositAmount.toString(),
        includesApproval: transaction?.includesApproval,
        costs,
        network,
      });

      const { hash } = await transaction.execute();

      this.logger.log({
        event: "wallet_deposit_succeeded",
        transactionHash: hash,
        depositAmount: transaction.depositAmount.toString(),
        includesApproval: transaction.includesApproval,
        costs,
        network,
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

  // See docs/checks/production-configuration-and-approval-methodology.md#sps-in-scope-for-testing
  private isDevProvider(info: PDPProvider): boolean {
    return info.pdp.extraCapabilities?.serviceStatus === DEV_TAG;
  }
}
