import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
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
