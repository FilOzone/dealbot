import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { IBlockchainConfig, IConfig } from "../config/app.config.js";
import { Queries } from "./queries.js";
import type { GraphQLResponse, ProviderDataSetResponse, ProvidersWithDataSetsOptions, SubgraphMeta } from "./types.js";
import { validateProviderDataSetResponse, validateSubgraphMetaResponse } from "./types.js";

/**
 * Error thrown when data validation fails.
 * These errors should not be retried as they indicate schema/data issues.
 */
class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

@Injectable()
export class PDPSubgraphService {
  private readonly logger: Logger = new Logger(PDPSubgraphService.name);
  private readonly blockchainConfig: IBlockchainConfig;

  private static readonly MAX_PROVIDERS_PER_QUERY = 100;
  private static readonly MAX_CONCURRENT_REQUESTS = 50;
  private static readonly RATE_LIMIT_WINDOW_MS = 10000;
  private static readonly MAX_RETRIES = 3;
  private static readonly INITIAL_RETRY_DELAY_MS = 1000;

  private requestTimestamps: number[] = [];

  constructor(private readonly configService: ConfigService<IConfig, true>) {
    this.blockchainConfig = this.configService.get<IBlockchainConfig>("blockchain");
  }

  /**
   * Fetch subgraph metadata including the latest indexed block number and timestamp
   *
   * @param attempt - Current retry attempt number (default: 1)
   * @returns Subgraph metadata with block information
   * @throws Error if endpoint is not configured or after MAX_RETRIES attempts
   */
  async fetchSubgraphMeta(attempt: number = 1): Promise<SubgraphMeta> {
    if (!this.blockchainConfig.pdpSubgraphEndpoint) {
      throw new Error("No PDP subgraph endpoint configured");
    }

    try {
      await this.enforceRateLimit();

      const response = await fetch(this.blockchainConfig.pdpSubgraphEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: Queries.GET_SUBGRAPH_META,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = (await response.json()) as GraphQLResponse;

      if (result.errors) {
        const errorMessage = result.errors?.[0]?.message || "Unknown GraphQL error";
        throw new Error(`GraphQL error: ${errorMessage}`);
      }
      let validated: SubgraphMeta;
      try {
        validated = validateSubgraphMetaResponse(result.data);
      } catch (validationError) {
        const errorMessage = validationError instanceof Error ? validationError.message : "Unknown validation error";
        throw new ValidationError(`Data validation failed: ${errorMessage}`);
      }

      return validated;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      // No need to retry on validation errors - they indicate schema/data issues, not transient failures
      if (error instanceof ValidationError) {
        this.logger.error(`Subgraph data validation failed: ${errorMessage}`);
        throw error;
      }

      // Retry on network/HTTP errors
      if (attempt < PDPSubgraphService.MAX_RETRIES) {
        const delay = PDPSubgraphService.INITIAL_RETRY_DELAY_MS * (1 << (attempt - 1));
        this.logger.warn(
          `Subgraph meta request failed (attempt ${attempt}/${PDPSubgraphService.MAX_RETRIES}): ${errorMessage}. Retrying in ${delay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.fetchSubgraphMeta(attempt + 1);
      }

      this.logger.error(
        `Subgraph meta request failed after ${PDPSubgraphService.MAX_RETRIES} attempts: ${errorMessage}`,
      );
      throw new Error(
        `Failed to fetch subgraph metadata after ${PDPSubgraphService.MAX_RETRIES} attempts: ${errorMessage}`,
      );
    }
  }

  /**
   * Fetch providers with datasets from subgraph with batching, pagination, and rate limiting
   *
   * @param options - Options containing block number and provider addresses
   * @returns Array of providers with their datasets
   */
  async fetchProvidersWithDatasets(
    options: ProvidersWithDataSetsOptions,
  ): Promise<ProviderDataSetResponse["providers"]> {
    const { blockNumber, addresses } = options;

    if (addresses.length === 0) {
      return [];
    }

    if (addresses.length <= PDPSubgraphService.MAX_PROVIDERS_PER_QUERY) {
      return this.fetchWithRetry(blockNumber, addresses);
    }

    return this.fetchMultipleBatchesWithRateLimit(blockNumber, addresses);
  }

  /**
   * Fetch multiple batches with rate limiting and concurrency control
   */
  private async fetchMultipleBatchesWithRateLimit(
    blockNumber: number,
    addresses: string[],
  ): Promise<ProviderDataSetResponse["providers"]> {
    const batches: string[][] = [];
    for (let i = 0; i < addresses.length; i += PDPSubgraphService.MAX_PROVIDERS_PER_QUERY) {
      const addressesLimit = Math.min(addresses.length, i + PDPSubgraphService.MAX_PROVIDERS_PER_QUERY);
      batches.push(addresses.slice(i, addressesLimit));
    }

    const allProviders: ProviderDataSetResponse["providers"] = [];

    for (let i = 0; i < batches.length; i += PDPSubgraphService.MAX_CONCURRENT_REQUESTS) {
      const batchGroup = batches.slice(i, i + PDPSubgraphService.MAX_CONCURRENT_REQUESTS);

      const results = await Promise.all(batchGroup.map((batch) => this.fetchWithRetry(blockNumber, batch)));

      allProviders.push(...results.flat());
    }

    return allProviders;
  }

  /**
   * Fetch with exponential backoff retry mechanism
   * Assuming initial request to be first attempt
   */
  private async fetchWithRetry(
    blockNumber: number,
    addresses: string[],
    attempt: number = 1,
  ): Promise<ProviderDataSetResponse["providers"]> {
    if (!this.blockchainConfig.pdpSubgraphEndpoint) {
      throw new Error("No PDP subgraph endpoint configured");
    }

    const variables = {
      blockNumber: blockNumber.toString(),
      addresses,
    };

    try {
      await this.enforceRateLimit();

      const response = await fetch(this.blockchainConfig.pdpSubgraphEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: Queries.GET_PROVIDERS_WITH_DATASETS,
          variables,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = (await response.json()) as GraphQLResponse;

      if (result.errors) {
        const errorMessage = result.errors?.[0]?.message || "Unknown GraphQL error";
        throw new Error(`GraphQL error: ${errorMessage}`);
      }

      let validated: ProviderDataSetResponse;
      try {
        validated = validateProviderDataSetResponse(result.data);
      } catch (validationError) {
        const errorMessage = validationError instanceof Error ? validationError.message : "Unknown validation error";
        throw new ValidationError(`Data validation failed: ${errorMessage}`);
      }

      return validated.providers;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      // No need to retry on validation errors - they indicate schema/data issues, not transient failures
      if (error instanceof ValidationError) {
        this.logger.error(`Subgraph data validation failed: ${errorMessage}`);
        throw error;
      }

      // Retry on network/HTTP errors
      if (attempt < PDPSubgraphService.MAX_RETRIES) {
        const delay = PDPSubgraphService.INITIAL_RETRY_DELAY_MS * (1 << (attempt - 1));
        this.logger.warn(
          `Subgraph request failed (attempt ${attempt}/${PDPSubgraphService.MAX_RETRIES}): ${errorMessage}. Retrying in ${delay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.fetchWithRetry(blockNumber, addresses, attempt + 1);
      }

      this.logger.error(`Subgraph request failed after ${PDPSubgraphService.MAX_RETRIES} attempts: ${errorMessage}`);
      throw new Error(
        `Failed to fetch provider data after ${PDPSubgraphService.MAX_RETRIES} attempts: ${errorMessage}`,
      );
    }
  }

  /**
   * Enforce rate limiting: max 50 requests per 10 seconds
   * This rate limit is applied by Goldsky on their public endpoints
   * Read more here: https://docs.goldsky.com/subgraphs/graphql-endpoints#public-endpoints
   */
  private async enforceRateLimit(requestCount: number = 1): Promise<void> {
    if (requestCount > PDPSubgraphService.MAX_CONCURRENT_REQUESTS) {
      throw new Error(
        `Cannot request ${requestCount} items; exceeds rate limit window of ${PDPSubgraphService.MAX_CONCURRENT_REQUESTS}`,
      );
    }

    const now = Date.now();
    const windowStart = now - PDPSubgraphService.RATE_LIMIT_WINDOW_MS;

    this.requestTimestamps = this.requestTimestamps.filter((timestamp) => timestamp > windowStart);

    const availableSlots = PDPSubgraphService.MAX_CONCURRENT_REQUESTS - this.requestTimestamps.length;

    if (requestCount > availableSlots) {
      const requiredSlots = requestCount - availableSlots;

      const index = Math.min(this.requestTimestamps.length, requiredSlots) - 1;
      const oldestTimestamp = this.requestTimestamps[index] || now;

      // wait time with 10ms buffer
      const waitTime = oldestTimestamp + PDPSubgraphService.RATE_LIMIT_WINDOW_MS - now + 10;

      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        return this.enforceRateLimit(requestCount);
      }
    }

    // Reserve the slots NOW
    for (let i = 0; i < requestCount; i++) {
      this.requestTimestamps.push(Date.now());
    }
  }
}
