import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { toStructuredError } from "../common/logging.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";

/**
 * Service for querying storage provider records and fetching
 * Curio version info from provider service endpoints.
 */
@Injectable()
export class ProvidersService {
  private readonly logger = new Logger(ProvidersService.name);

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

    if (options?.limit) {
      query.limit(options.limit);
    }
    if (options?.offset) {
      query.offset(options.offset);
    }

    const providers = await query.getMany();

    return { providers, total };
  }

  /**
   * Get a single provider by address.
   */
  async getProvider(address: string): Promise<StorageProvider> {
    const provider = await this.spRepository.findOne({ where: { address } });

    if (!provider) {
      throw new NotFoundException(`Provider not found for address ${address}`);
    }

    return provider;
  }

  /**
   * Fetch Curio version from a provider's service URL.
   */
  async getProviderCurioVersion(spAddress: string): Promise<string> {
    const provider = await this.getProvider(spAddress);

    if (!provider.serviceUrl) {
      throw new NotFoundException(`Service URL not available for provider ${spAddress}`);
    }

    try {
      const versionUrl = `${provider.serviceUrl}/version`;
      this.logger.debug(`Fetching version from: ${versionUrl}`);

      const response = await fetch(versionUrl, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; DealBot/1.0)",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const version = await response.text();
      this.logger.debug(`Retrieved version for ${spAddress}: ${version}`);

      return version;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({
        event: "fetch_provider_curio_version_failed",
        message: `Failed to fetch version for ${spAddress}`,
        spAddress,
        error: toStructuredError(error),
      });
      throw new NotFoundException(`Unable to fetch version from provider ${spAddress}: ${errorMessage}`);
    }
  }

  /**
   * Batch-fetch Curio versions for multiple providers.
   */
  async getProviderCurioVersionsBatch(spAddresses: string[]): Promise<Record<string, string>> {
    this.logger.debug(`Batch fetching versions for ${spAddresses.length} providers`);

    const versionPromises = spAddresses.map(async (spAddress) => {
      try {
        const version = await this.getProviderCurioVersion(spAddress);
        return { spAddress, version };
      } catch (error) {
        this.logger.warn({
          event: "fetch_provider_curio_version_failed",
          message: `Failed to fetch version for ${spAddress}`,
          spAddress,
          error: toStructuredError(error),
        });
        return { spAddress, version: null };
      }
    });

    const results = await Promise.all(versionPromises);

    const versionMap: Record<string, string> = {};
    for (const result of results) {
      if (result.version) {
        versionMap[result.spAddress] = result.version;
      }
    }

    return versionMap;
  }
}
