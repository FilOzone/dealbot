import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import type { Network } from "../../common/types.js";
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
  ) {}

  async findByAddress(address: string, network: Network): Promise<PDPProviderEx | undefined> {
    const row = await this.repo.findOne({ where: { address, network } });
    return row ? this.hydrateProvider(row) : undefined;
  }

  async findTestingProviders(network: Network, useOnlyApprovedProviders: boolean): Promise<PDPProviderEx[]> {
    const rows = await this.repo.find({
      where: { network, isActive: true, ...(useOnlyApprovedProviders ? { isApproved: true } : {}) },
    });
    return rows.map((row) => this.hydrateProvider(row));
  }

  async countByNetwork(network: Network): Promise<number> {
    return this.repo.count({ where: { network } });
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
