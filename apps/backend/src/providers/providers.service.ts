import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import type { IConfig } from "../config/app.config.js";
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
   */
  async getProvidersList(options?: {
    activeOnly?: boolean;
    approvedOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ providers: StorageProvider[]; total: number }> {
    const query = this.spRepository.createQueryBuilder("sp");

    if (options?.activeOnly) {
      query.andWhere("sp.is_active = true");
    }

    if (options?.approvedOnly) {
      query.andWhere("sp.is_approved = true");
    }

    // Filter out blocked providers
    const blocklists = this.configService.get("spBlocklists", { infer: true });
    if (blocklists.ids.size > 0) {
      // providerId is BigInt in the entity, so we convert strings to BigInts for the query
      const blockedIds = Array.from(blocklists.ids)
        .map((id) => {
          try {
            return BigInt(id);
          } catch {
            return null;
          }
        })
        .filter((id): id is bigint => id !== null);

      if (blockedIds.length > 0) {
        query.andWhere('("sp"."providerId" IS NULL OR "sp"."providerId" NOT IN (:...blockedIds))', {
          blockedIds,
        });
      }
    }

    if (blocklists.addresses.size > 0) {
      query.andWhere('LOWER("sp"."address") NOT IN (:...blockedAddresses)', {
        blockedAddresses: Array.from(blocklists.addresses),
      });
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
