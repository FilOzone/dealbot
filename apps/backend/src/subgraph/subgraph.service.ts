import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { delay } from "../common/abort-utils.js";
import { toStructuredError } from "../common/logging.js";
import type { Network } from "../common/types.js";
import type { IConfig } from "../config/index.js";
import { buildSamplePieceQuery, Queries } from "./queries.js";
import type {
  CandidatePiece,
  GraphQLResponse,
  ProviderDataSetResponse,
  ProvidersWithDataSetsOptions,
  RawSamplePieceResponse,
  SubgraphMeta,
} from "./types.js";
import {
  decodePieceCid,
  validateProviderDataSetResponse,
  validateSamplePieceResponse,
  validateSubgraphMetaResponse,
} from "./types.js";

/** Pool of pieces to sample from. */
export type PiecePool = "indexed" | "any";

/** Inputs for a single anonymous piece sample query. */
export type SamplePieceParams = {
  /** Service provider address (lowercase hex). */
  serviceProvider: string;
  /** Dealbot's own payer address (excluded to keep the sample non-dealbot). */
  payer: string;
  /** Uniform-random 32-byte sort key as `0x`-prefixed hex. */
  sampleKey: string;
  /** Inclusive lower bound on raw piece size in bytes (decimal string). */
  minSize: string;
  /** Inclusive upper bound on raw piece size in bytes (decimal string). */
  maxSize: string;
  /** Which pool to sample from. */
  pool: PiecePool;
};

/**
 * Error thrown when data validation fails.
 * These errors should not be retried as they indicate schema/data issues.
 */
class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ValidationError);
    }
  }
}

/**
 * Client for the dealbot-owned subgraph (driven by `SUBGRAPH_ENDPOINT`).
 *
 * Functionally a superset of `PDPSubgraphService`: it exposes the same
 * `fetchSubgraphMeta` / `fetchProvidersWithDatasets` surface plus the new
 * `samplePiece` query used by anonymous retrievals.
 *
 * The two services intentionally coexist while we migrate off the upstream
 * pdp-explorer subgraph: `PDPSubgraphService` continues to drive the
 * established data-retention path against `PDP_SUBGRAPH_ENDPOINT`, and
 * `SubgraphService` is scoped to the new anonymous-retrieval flow only.
 * Once the dealbot-owned subgraph has soaked in production, this service
 * should become the single drop-in replacement for `PDPSubgraphService`
 * and `PDP_SUBGRAPH_ENDPOINT` can be retired.
 */
@Injectable()
export class SubgraphService {
  private readonly logger: Logger = new Logger(SubgraphService.name);

  private static readonly MAX_PROVIDERS_PER_QUERY = 100;
  private static readonly MAX_CONCURRENT_REQUESTS = 50;
  private static readonly RATE_LIMIT_WINDOW_MS = 10000;
  private static readonly MAX_RETRIES = 3;
  private static readonly INITIAL_RETRY_DELAY_MS = 1000;

  private requestTimestamps: number[] = [];

  constructor(private readonly configService: ConfigService<IConfig, true>) {}

  /**
   * Resolve the dealbot-owned subgraph endpoint for a given network. Each
   * network points at its own subgraph deployment.
   */
  private subgraphEndpoint(network: Network): string | undefined {
    return this.configService.get("networks", { infer: true })[network].subgraphEndpoint;
  }

  /**
   * Fetch subgraph metadata including the latest indexed block number.
   *
   * @throws Error if endpoint is not configured or after MAX_RETRIES attempts
   */
  async fetchSubgraphMeta(network: Network): Promise<SubgraphMeta> {
    return this.executeQuery<SubgraphMeta>(
      network,
      "metadata",
      Queries.GET_SUBGRAPH_META,
      {},
      validateSubgraphMetaResponse,
    );
  }

  /**
   * Fetch provider-level totals from subgraph with batching, pagination, and rate limiting
   *
   * @param options - Options containing block number and provider addresses
   * @returns Array of providers with their data sets currently proving
   */
  async fetchProvidersWithDatasets(
    network: Network,
    options: ProvidersWithDataSetsOptions,
  ): Promise<ProviderDataSetResponse["providers"]> {
    const { blockNumber, addresses } = options;

    if (addresses.length === 0) {
      return [];
    }

    if (addresses.length <= SubgraphService.MAX_PROVIDERS_PER_QUERY) {
      return this.fetchWithRetry(network, blockNumber, addresses);
    }

    return this.fetchMultipleBatchesWithRateLimit(network, blockNumber, addresses);
  }

  /**
   * Draw a single random anonymous piece for retrieval testing.
   *
   * Uses the Root.sampleKey (keccak256 of the entity id) to pick the piece
   * closest to `params.sampleKey`. Runs the forward query first
   * (`sampleKey_gte`, asc — smallest key at or above the target) and falls
   * back to the reverse query (`sampleKey_lt`, desc — largest key below the
   * target) only when the forward query returns nothing. The fallback covers
   * the wrap-around dead zone where the random key happens to exceed every
   * matching sampleKey; without it those draws would waste a fresh
   * sampleKey roundtrip in the caller.
   *
   * Server-side filters cover SP, payer-exclusion, active status, size
   * range, and optionally `withIPFSIndexing`. Returns null only when no
   * piece in either direction matches the filters.
   *
   * `pdpPaymentEndEpoch` is returned to the caller for a cheap client-side
   * epoch comparison — GraphQL filters on nullable BigInts are awkward.
   * However this will be changed in the context of https://github.com/FilOzone/dealbot/issues/579.
   */
  async samplePiece(network: Network, params: SamplePieceParams, signal?: AbortSignal): Promise<CandidatePiece | null> {
    if (!this.subgraphEndpoint(network)) {
      // Surface misconfiguration distinctly so it does not look like an empty
      // candidate pool (which silently no-ops every sampled retrieval job).
      this.logger.error({
        event: "subgraph_endpoint_not_configured",
        message: "Cannot sample anonymous piece — no subgraph endpoint configured",
        network,
      });
      throw new Error("No subgraph endpoint configured");
    }

    const variables = {
      serviceProvider: params.serviceProvider.toLowerCase(),
      payer: params.payer.toLowerCase(),
      sampleKey: params.sampleKey,
      minSize: params.minSize,
      maxSize: params.maxSize,
    };

    for (const reverse of [false, true]) {
      const validated = await this.executeQuery<RawSamplePieceResponse>(
        network,
        `sample_piece_${params.pool}_${reverse ? "reverse" : "forward"}`,
        buildSamplePieceQuery(params.pool, reverse),
        variables,
        validateSamplePieceResponse,
        signal,
      );

      const root = validated.roots[0];
      if (!root) {
        continue;
      }

      try {
        return {
          pieceCid: decodePieceCid(root.cid),
          pieceId: root.rootId,
          dataSetId: root.proofSet.setId,
          rawSize: root.rawSize,
          withIPFSIndexing: root.proofSet.withIPFSIndexing,
          ipfsRootCid: root.ipfsRootCID ?? null,
          indexedAtBlock: validated._meta.block.number,
          pdpPaymentEndEpoch:
            root.proofSet.pdpPaymentEndEpoch != null ? BigInt(root.proofSet.pdpPaymentEndEpoch) : null,
        };
      } catch (error) {
        this.logger.warn({
          event: "sampled_piece_cid_decode_failed",
          message: "Failed to decode piece CID from subgraph data",
          dataSetId: root.proofSet.setId,
          pieceId: root.rootId,
          error: toStructuredError(error),
        });
        return null;
      }
    }

    return null;
  }

  /**
   * Generic single-query helper with retry and rate limiting. Used by queries that
   * don't fit the batched provider-fetch shape.
   */
  private async executeQuery<T>(
    network: Network,
    operationName: string,
    query: string,
    variables: Record<string, unknown>,
    transform: (data: unknown) => T,
    signal?: AbortSignal,
    attempt: number = 1,
  ): Promise<T> {
    const endpoint = this.subgraphEndpoint(network);
    if (!endpoint) {
      throw new Error("No subgraph endpoint configured");
    }

    try {
      await this.enforceRateLimit(1, signal);

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
        signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = (await response.json()) as GraphQLResponse;

      if (result.errors) {
        const errorMessage = result.errors?.[0]?.message || "Unknown GraphQL error";
        throw new Error(`GraphQL error: ${errorMessage}`);
      }

      try {
        return transform(result.data);
      } catch (validationError) {
        const errorMessage = validationError instanceof Error ? validationError.message : "Unknown validation error";
        throw new ValidationError(`Data validation failed: ${errorMessage}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      if (error instanceof ValidationError) {
        this.logger.error({
          event: `subgraph_${operationName}_validation_failed`,
          message: `Subgraph ${operationName} validation failed`,
          error: toStructuredError(error),
        });
        throw error;
      }

      // Aborted requests should surface immediately — retrying after the job
      // budget has been spent only wastes the remaining MAX_RETRIES slots.
      if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw error;
      }

      if (attempt < SubgraphService.MAX_RETRIES) {
        const delayMs = SubgraphService.INITIAL_RETRY_DELAY_MS * (1 << (attempt - 1));
        this.logger.warn({
          event: `subgraph_${operationName}_request_retry`,
          message: `Subgraph ${operationName} request failed. Retrying...`,
          attempt,
          maxRetries: SubgraphService.MAX_RETRIES,
          retryDelayMs: delayMs,
          error: toStructuredError(error),
        });
        await delay(delayMs, signal);
        return this.executeQuery(network, operationName, query, variables, transform, signal, attempt + 1);
      }

      this.logger.error({
        event: `subgraph_${operationName}_request_failed`,
        message: `Subgraph ${operationName} request failed after maximum retries`,
        maxRetries: SubgraphService.MAX_RETRIES,
        error: toStructuredError(error),
      });
      throw new Error(
        `Failed to fetch subgraph ${operationName} after ${SubgraphService.MAX_RETRIES} attempts: ${errorMessage}`,
      );
    }
  }

  /**
   * Fetch multiple batches with rate limiting and concurrency control
   */
  private async fetchMultipleBatchesWithRateLimit(
    network: Network,
    blockNumber: number,
    addresses: string[],
  ): Promise<ProviderDataSetResponse["providers"]> {
    const batches: string[][] = [];
    for (let i = 0; i < addresses.length; i += SubgraphService.MAX_PROVIDERS_PER_QUERY) {
      const addressesLimit = Math.min(addresses.length, i + SubgraphService.MAX_PROVIDERS_PER_QUERY);
      batches.push(addresses.slice(i, addressesLimit));
    }

    const allProviders: ProviderDataSetResponse["providers"] = [];

    for (let i = 0; i < batches.length; i += SubgraphService.MAX_CONCURRENT_REQUESTS) {
      const batchGroup = batches.slice(i, i + SubgraphService.MAX_CONCURRENT_REQUESTS);

      const results = await Promise.all(batchGroup.map((batch) => this.fetchWithRetry(network, blockNumber, batch)));

      allProviders.push(...results.flat());
    }

    return allProviders;
  }

  /**
   * Fetch with exponential backoff retry mechanism
   * Assuming initial request to be first attempt
   */
  private async fetchWithRetry(
    network: Network,
    blockNumber: number,
    addresses: string[],
    attempt: number = 1,
  ): Promise<ProviderDataSetResponse["providers"]> {
    const endpoint = this.subgraphEndpoint(network);
    if (!endpoint) {
      throw new Error("No subgraph endpoint configured");
    }

    const variables = {
      blockNumber: blockNumber.toString(),
      addresses,
    };

    try {
      await this.enforceRateLimit();

      const response = await fetch(endpoint, {
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
        this.logger.error({
          event: "subgraph_provider_data_validation_failed",
          message: "Subgraph data validation failed",
          error: toStructuredError(error),
        });
        throw error;
      }

      // Retry on network/HTTP errors
      if (attempt < SubgraphService.MAX_RETRIES) {
        const delay = SubgraphService.INITIAL_RETRY_DELAY_MS * (1 << (attempt - 1));
        this.logger.warn({
          event: "subgraph_provider_request_retry",
          message: "Subgraph provider request failed. Retrying...",
          attempt,
          maxRetries: SubgraphService.MAX_RETRIES,
          retryDelayMs: delay,
          addressCount: addresses.length,
          error: toStructuredError(error),
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.fetchWithRetry(network, blockNumber, addresses, attempt + 1);
      }

      this.logger.error({
        event: "subgraph_provider_request_failed",
        message: "Subgraph provider request failed after maximum retries",
        maxRetries: SubgraphService.MAX_RETRIES,
        blockNumber,
        addressCount: addresses.length,
        error: toStructuredError(error),
      });
      throw new Error(`Failed to fetch provider data after ${SubgraphService.MAX_RETRIES} attempts: ${errorMessage}`);
    }
  }

  /**
   * Enforce rate limiting: max 50 requests per 10 seconds
   * This rate limit is applied by Goldsky on their public endpoints
   * Read more here: https://docs.goldsky.com/subgraphs/graphql-endpoints#public-endpoints
   */
  private async enforceRateLimit(requestCount: number = 1, signal?: AbortSignal): Promise<void> {
    if (requestCount > SubgraphService.MAX_CONCURRENT_REQUESTS) {
      throw new Error(
        `Cannot request ${requestCount} items; exceeds rate limit window of ${SubgraphService.MAX_CONCURRENT_REQUESTS}`,
      );
    }

    const now = Date.now();
    const windowStart = now - SubgraphService.RATE_LIMIT_WINDOW_MS;

    this.requestTimestamps = this.requestTimestamps.filter((timestamp) => timestamp > windowStart);

    const availableSlots = SubgraphService.MAX_CONCURRENT_REQUESTS - this.requestTimestamps.length;

    if (requestCount > availableSlots) {
      const requiredSlots = requestCount - availableSlots;

      const index = Math.min(this.requestTimestamps.length, requiredSlots) - 1;
      const oldestTimestamp = this.requestTimestamps[index] || now;

      // wait time with 10ms buffer
      const waitTime = oldestTimestamp + SubgraphService.RATE_LIMIT_WINDOW_MS - now + 10;

      if (waitTime > 0) {
        await delay(waitTime, signal);
        return this.enforceRateLimit(requestCount, signal);
      }
    }

    // Reserve the slots NOW
    for (let i = 0; i < requestCount; i++) {
      this.requestTimestamps.push(Date.now());
    }
  }
}
