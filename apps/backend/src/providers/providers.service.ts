import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import type { Network } from "../common/types.js";
import type { IConfig } from "../config/index.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";

/**
 * Service for querying storage provider records and fetching
 * Curio version info from provider service endpoints.
 */
@Injectable()
export class ProvidersService {
  constructor(
    @InjectRepository(StorageProvider)
    private readonly spRepository: Repository<StorageProvider>,
    private readonly configService: ConfigService<IConfig, true>,
  ) {}

  /**
   * Get paginated/filtered provider list.
   *
   * When `network` is provided, results are scoped to that network and only
   * that network's blocklist is applied.
   *
   * When `network` is omitted, results span all active networks and the
   * blocklist for each network is applied, preserving the pre-multi-network
   * behaviour of a single global blocklist.
   */
  async getProvidersList(options?: {
    activeOnly?: boolean;
    approvedOnly?: boolean;
    network?: Network;
    limit?: number;
    offset?: number;
  }): Promise<{ providers: StorageProvider[]; total: number }> {
    const query = this.spRepository.createQueryBuilder("sp");

    if (options?.network) {
      query.andWhere("sp.network = :network", { network: options.network });
    }

    if (options?.activeOnly) {
      query.andWhere("sp.is_active = true");
    }

    if (options?.approvedOnly) {
      query.andWhere("sp.is_approved = true");
    }

    // Filter out blocked providers
    const networksConfig = this.configService.get("networks", { infer: true });
    const activeNetworks = this.configService.get("activeNetworks", { infer: true });
    const networksToFilter: Network[] = options?.network ? [options.network] : activeNetworks;

    for (const net of networksToFilter) {
      const cfg = networksConfig[net];

      const blockedIds: bigint[] = [];
      for (const id of cfg.blockedSpIds) {
        try {
          blockedIds.push(BigInt(id));
        } catch {
          // skip malformed ID strings
        }
      }

      const blockedAddresses = Array.from(cfg.blockedSpAddresses).map((a) => a.toLowerCase());

      if (blockedIds.length > 0) {
        query.andWhere(
          `("sp"."providerId" IS NULL OR NOT ("sp"."network" = :network_${net} AND "sp"."providerId" IN (:...blockedIds_${net})))`,
          { [`network_${net}`]: net, [`blockedIds_${net}`]: blockedIds },
        );
      }

      if (blockedAddresses.length > 0) {
        query.andWhere(
          `NOT ("sp"."network" = :network_${net} AND LOWER("sp"."address") IN (:...blockedAddresses_${net}))`,
          { [`network_${net}`]: net, [`blockedAddresses_${net}`]: blockedAddresses },
        );
      }
    }

    const total = await query.getCount();

    if (options?.limit != null) {
      query.limit(options.limit);
    }
    if (options?.offset != null) {
      query.offset(options.offset);
    }

    const providers = await query.getMany();

    return { providers, total };
  }
}
