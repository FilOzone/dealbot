import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { IBlockchainConfig, IConfig } from "../config/app.config.js";
import { Queries } from "./queries.js";
import type { IProviderDataSetResponse, ProvidersWithDataSetsOptions } from "./types.js";
import { validateProviderDataSetResponse } from "./types.js";

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
   * Fetch providers with datasets from subgraph with batching, pagination, and rate limiting
   *
   * @param options - Options containing block number and provider addresses
   * @returns Array of providers with their datasets
   */
  async fetchProvidersWithDatasets(
    options: ProvidersWithDataSetsOptions,
  ): Promise<IProviderDataSetResponse["providers"]> {
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
  ): Promise<IProviderDataSetResponse["providers"]> {
    const batches: string[][] = [];
    for (let i = 0; i < addresses.length; i += PDPSubgraphService.MAX_PROVIDERS_PER_QUERY) {
      const addressesLimit = Math.min(addresses.length, i + PDPSubgraphService.MAX_PROVIDERS_PER_QUERY);
      batches.push(addresses.slice(i, addressesLimit));
    }

    const allProviders: IProviderDataSetResponse["providers"] = [];

    for (let i = 0; i < batches.length; i += PDPSubgraphService.MAX_CONCURRENT_REQUESTS) {
      const batchGroup = batches.slice(i, i + PDPSubgraphService.MAX_CONCURRENT_REQUESTS);

      await this.enforceRateLimit(batchGroup.length);

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
  ): Promise<IProviderDataSetResponse["providers"]> {
    if (!this.blockchainConfig.pdpSubgraphEndpoint) {
      throw new Error("No PDP subgraph endpoint configured");
    }

    const variables = {
      blockNumber: blockNumber.toString(),
      addresses,
    };

    try {
      this.trackRequest();

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

      const result = (await response.json()) as { data: unknown; errors?: unknown };

      if (result.errors) {
        const errorMessage = (result.errors as { message: string }[])?.[0]?.message || "Unknown GraphQL error";
        throw new Error(`GraphQL error: ${errorMessage}`);
      }

      let validated: IProviderDataSetResponse;
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
   * Track request timestamp for rate limiting
   */
  private trackRequest(): void {
    this.requestTimestamps.push(Date.now());
  }

  /**
   * Enforce rate limiting: max 50 requests per 10 seconds
   * This rate limit is applied by Goldsky on their public endpoints
   * Read more here: https://docs.goldsky.com/subgraphs/graphql-endpoints#public-endpoints
   */
  private async enforceRateLimit(requestCount: number): Promise<void> {
    const now = Date.now();
    const windowStart = now - PDPSubgraphService.RATE_LIMIT_WINDOW_MS;

    this.requestTimestamps = this.requestTimestamps.filter((timestamp) => timestamp > windowStart);

    const availableSlots = PDPSubgraphService.MAX_CONCURRENT_REQUESTS - this.requestTimestamps.length;

    if (requestCount > availableSlots) {
      const oldestTimestamp = this.requestTimestamps[0] || now;
      const waitTime = oldestTimestamp + PDPSubgraphService.RATE_LIMIT_WINDOW_MS - now;

      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        return this.enforceRateLimit(requestCount);
      }
    }
  }
}
