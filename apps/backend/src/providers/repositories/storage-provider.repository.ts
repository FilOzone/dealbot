import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Raw, type Repository } from "typeorm";
import type { Network } from "../../common/types.js";
import type { IConfig } from "../../config/index.js";
import { StorageProvider } from "../../database/entities/storage-provider.entity.js";
import type { PDPProviderEx } from "../../wallet-sdk/wallet-sdk.types.js";

const BIGINT_PDP_FIELDS = [
  "minPieceSizeInBytes",
  "maxPieceSizeInBytes",
  "storagePricePerTibPerDay",
  "minProvingPeriodInEpochs",
] as const;

@Injectable()
export class StorageProviderRepository {
  private readonly logger = new Logger(StorageProviderRepository.name);

  constructor(
    @InjectRepository(StorageProvider)
    private readonly repo: Repository<StorageProvider>,
    private readonly configService: ConfigService<IConfig, true>,
  ) {}

  async findByAddress(address: string, network: Network): Promise<PDPProviderEx | undefined> {
    const row = await this.repo.findOne({ where: { address, network } });
    return row ? this.hydrateProvider(row) : undefined;
  }

  /**
   * Testing providers are active providers, further narrowed to approved-only
   * when the network config requires it (mirrors the policy `WalletSdkService`
   * used to apply from its in-memory `NetworkState.config`).
   */
  async findTestingProviders(network: Network): Promise<PDPProviderEx[]> {
    const { useOnlyApprovedProviders } = this.configService.get("networks", { infer: true })[network];
    const rows = await this.repo.find({
      where: { network, isActive: true, ...(useOnlyApprovedProviders ? { isApproved: true } : {}) },
    });
    return rows.map((row) => this.hydrateProvider(row));
  }

  async countByNetwork(network: Network): Promise<number> {
    return this.repo.count({ where: { network } });
  }

  async countActiveByNetwork(network: Network): Promise<number> {
    return this.repo.count({ where: { network, isActive: true } });
  }

  /**
   * Count of testing providers (active, optionally approved-only per network
   * policy) — mirrors the `isActive`/`isApproved` filter in `findActiveAddresses`,
   * but as a single count query for callers that don't need the rows themselves.
   */
  async countTestedByNetwork(network: Network): Promise<number> {
    const { useOnlyApprovedProviders } = this.configService.get("networks", { infer: true })[network];
    return this.repo.count({
      where: { network, isActive: true, ...(useOnlyApprovedProviders ? { isApproved: true } : {}) },
    });
  }

  /**
   * Address + providerId projection for active (optionally approved-only)
   * providers — used by callers that need to iterate addresses (job
   * scheduling, blocklist filtering) without the full hydrated object.
   */
  async findActiveAddresses(network: Network): Promise<Array<{ address: string; providerId: bigint | null }>> {
    const { useOnlyApprovedProviders } = this.configService.get("networks", { infer: true })[network];
    const rows = await this.repo.find({
      select: { address: true, providerId: true },
      where: { network, isActive: true, ...(useOnlyApprovedProviders ? { isApproved: true } : {}) },
    });
    return rows.map((row) => ({ address: row.address, providerId: row.providerId }));
  }

  /**
   * Raw entity lookup for callers that need to assign the actual `StorageProvider`
   * entity (e.g. as a TypeORM relation before saving), not the hydrated `PDPProviderEx`.
   */
  async findEntityByAddress(address: string, network: Network): Promise<StorageProvider | null> {
    return this.repo.findOne({ where: { address, network } });
  }

  /**
   * Case-insensitive lookup by a list of addresses, with a narrow projection —
   * used for reconciling addresses (e.g. detecting stale entries) against
   * whatever casing the caller's source of the address list happens to use.
   */
  async findByAddressesCaseInsensitive(
    addresses: string[],
    network: Network,
  ): Promise<Array<Pick<StorageProvider, "address" | "providerId" | "name" | "isApproved">>> {
    if (addresses.length === 0) {
      return [];
    }
    return this.repo.find({
      where: {
        network,
        address: Raw((alias) => `LOWER(${alias}) IN (:...addresses)`, { addresses }),
      },
      select: ["address", "providerId", "name", "isApproved"],
    });
  }

  async upsertFromRegistry(providers: PDPProviderEx[], network: Network): Promise<void> {
    const dedupedProviders = new Map<string, PDPProviderEx>();
    const duplicatesByAddress = new Map<string, Set<bigint>>();
    const conflictAddresses = new Set<string>();
    const resolvedInactiveAddresses = new Set<string>();

    for (const info of providers) {
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
        this.logger.error({
          event: "duplicate_provider_addresses_unresolved",
          message:
            "Duplicate provider addresses without active/inactive resolution; keeping highest providerId entries",
          network,
          details: formatDetails(conflictAddresses),
        });
      }

      if (resolvedOnly.size > 0) {
        this.logger.warn({
          event: "duplicate_provider_addresses_resolved",
          message: "Duplicate provider addresses detected; replaced inactive entries with active ones",
          network,
          details: formatDetails(resolvedOnly),
        });
      }
    }

    const entities = Array.from(dedupedProviders.values()).map((info) =>
      this.repo.create({
        network,
        address: info.serviceProvider,
        providerId: info.id,
        name: info.name,
        description: info.description,
        payee: info.payee,
        serviceUrl: info.pdp.serviceURL,
        isActive: info.isActive,
        isApproved: info.isApproved,
        location: info.pdp.location,
        metadata: JSON.parse(
          JSON.stringify(info.pdp, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
        ),
      }),
    );

    await this.repo.upsert(entities, {
      conflictPaths: ["address", "network"],
      skipUpdateIfNoValuesChanged: true,
    });
  }

  private hydrateProvider(row: StorageProvider): PDPProviderEx {
    const pdp: Record<string, unknown> = { ...(row.metadata as Record<string, unknown>) };
    for (const field of BIGINT_PDP_FIELDS) {
      if (typeof pdp[field] === "string") {
        pdp[field] = BigInt(pdp[field] as string);
      }
    }

    return {
      id: row.providerId ?? 0n,
      serviceProvider: row.address,
      payee: row.payee,
      name: row.name,
      description: row.description,
      isActive: row.isActive,
      isApproved: row.isApproved,
      pdp,
    } as unknown as PDPProviderEx;
  }
}
