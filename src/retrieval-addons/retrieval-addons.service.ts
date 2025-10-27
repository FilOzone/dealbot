import { Injectable, Logger } from "@nestjs/common";
import type { IRetrievalAddon } from "./interfaces/retrieval-addon.interface.js";
import type {
  RetrievalConfiguration,
  RetrievalUrlResult,
  RetrievalExecutionResult,
  RetrievalTestResult,
  ValidationResult,
} from "./types.js";
import { DirectRetrievalStrategy } from "./strategies/direct.strategy.js";
import { CdnRetrievalStrategy } from "./strategies/cdn.strategy.js";
import { IpniRetrievalStrategy } from "./strategies/ipni.strategy.js";
import { HttpClientService } from "../http-client/http-client.service.js";
import type { RequestWithMetrics } from "../http-client/types.js";

/**
 * Orchestrator service for managing retrieval add-ons
 * Coordinates the execution of multiple retrieval strategies
 * Implements the Strategy Pattern for flexible retrieval methods
 */
@Injectable()
export class RetrievalAddonsService {
  private readonly logger = new Logger(RetrievalAddonsService.name);
  private readonly addons: Map<string, IRetrievalAddon> = new Map();

  constructor(
    private readonly directRetrieval: DirectRetrievalStrategy,
    private readonly cdnRetrieval: CdnRetrievalStrategy,
    private readonly ipniRetrieval: IpniRetrievalStrategy,
    private readonly httpClientService: HttpClientService,
  ) {
    this.registerAddons();
  }

  /**
   * Register all available retrieval add-ons
   * @private
   */
  private registerAddons(): void {
    this.registerAddon(this.directRetrieval);
    this.registerAddon(this.cdnRetrieval);
    this.registerAddon(this.ipniRetrieval);

    this.logger.log(`Registered ${this.addons.size} retrieval add-ons: ${Array.from(this.addons.keys()).join(", ")}`);
  }

  /**
   * Register a single retrieval add-on
   * @param addon - Retrieval add-on to register
   * @private
   */
  private registerAddon(addon: IRetrievalAddon): void {
    if (this.addons.has(addon.name)) {
      this.logger.warn(`Retrieval add-on ${addon.name} is already registered, skipping`);
      return;
    }

    this.addons.set(addon.name, addon);
    this.logger.debug(`Registered retrieval add-on: ${addon.name} (priority: ${addon.priority})`);
  }

  /**
   * Get all applicable retrieval strategies for a deal
   * Strategies are sorted by priority (lower number = higher priority)
   *
   * @param config - Retrieval configuration
   * @returns Array of applicable strategies sorted by priority
   */
  getApplicableStrategies(config: RetrievalConfiguration): IRetrievalAddon[] {
    const applicable: IRetrievalAddon[] = [];

    for (const addon of this.addons.values()) {
      if (addon.canHandle(config)) {
        applicable.push(addon);
        this.logger.debug(`Retrieval strategy ${addon.name} is applicable for deal ${config.deal.id}`);
      }
    }

    // Sort by priority (ascending)
    return applicable.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get the preferred retrieval strategy (highest priority applicable one)
   *
   * @param config - Retrieval configuration
   * @returns Preferred strategy or null if none applicable
   */
  getPreferredStrategy(config: RetrievalConfiguration): IRetrievalAddon | null {
    const strategies = this.getApplicableStrategies(config);
    return strategies.length > 0 ? strategies[0] : null;
  }

  /**
   * Construct retrieval URL using the preferred strategy
   *
   * @param config - Retrieval configuration
   * @returns URL result from preferred strategy
   * @throws Error if no applicable strategy found
   */
  constructPreferredUrl(config: RetrievalConfiguration): RetrievalUrlResult {
    const strategy = this.getPreferredStrategy(config);

    if (!strategy) {
      throw new Error(`No applicable retrieval strategy found for deal ${config.deal.id}`);
    }

    this.logger.debug(`Using preferred strategy ${strategy.name} for deal ${config.deal.id}`);

    return strategy.constructUrl(config);
  }

  /**
   * Construct URLs for all applicable strategies
   * Useful for testing multiple retrieval methods
   *
   * @param config - Retrieval configuration
   * @returns Array of URL results from all applicable strategies
   */
  constructAllUrls(config: RetrievalConfiguration): RetrievalUrlResult[] {
    const strategies = this.getApplicableStrategies(config);

    if (strategies.length === 0) {
      this.logger.warn(`No applicable retrieval strategies found for deal ${config.deal.id}`);
      return [];
    }

    return strategies.map((strategy) => {
      try {
        return strategy.constructUrl(config);
      } catch (error) {
        this.logger.error(`Failed to construct URL with strategy ${strategy.name}: ${error.message}`);
        throw error;
      }
    });
  }

  /**
   * Perform retrieval using the preferred strategy
   *
   * @param config - Retrieval configuration
   * @returns Retrieval execution result
   */
  async performRetrieval(config: RetrievalConfiguration): Promise<RetrievalExecutionResult> {
    const urlResult = this.constructPreferredUrl(config);

    this.logger.log(`Performing retrieval for deal ${config.deal.id} using ${urlResult.method}: ${urlResult.url}`);

    return await this.executeRetrieval(urlResult, config);
  }

  /**
   * Test all applicable retrieval methods for a deal
   * Executes retrievals in parallel and compares results
   *
   * @param config - Retrieval configuration
   * @returns Test result with all method results and summary
   */
  async testAllRetrievalMethods(config: RetrievalConfiguration): Promise<RetrievalTestResult> {
    const startTime = Date.now();
    const urlResults = this.constructAllUrls(config);

    if (urlResults.length === 0) {
      throw new Error(`No retrieval methods available for deal ${config.deal.id}`);
    }

    this.logger.log(
      `Testing ${urlResults.length} retrieval methods for deal ${config.deal.id}: ` +
        `${urlResults.map((r) => r.method).join(", ")}`,
    );

    // Execute all retrievals in parallel
    const retrievalPromises = urlResults.map((urlResult) => this.executeRetrieval(urlResult, config));

    const results = await Promise.allSettled(retrievalPromises);

    // Process results
    const executionResults: RetrievalExecutionResult[] = results.map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      } else {
        // Create failed result
        return {
          url: urlResults[index].url,
          method: urlResults[index].method,
          data: Buffer.alloc(0),
          metrics: {
            latency: 0,
            ttfb: 0,
            throughput: 0,
            statusCode: 0,
            timestamp: new Date(),
            responseSize: 0,
          },
          success: false,
          error: result.reason?.message || "Unknown error",
        };
      }
    });

    // Calculate summary
    const successfulResults = executionResults.filter((r) => r.success);
    const fastestResult = successfulResults.reduce(
      (fastest, current) => (current.metrics.latency < fastest.metrics.latency ? current : fastest),
      successfulResults[0],
    );

    const duration = Date.now() - startTime;
    this.logger.log(
      `Retrieval test completed in ${duration}ms: ` +
        `${successfulResults.length}/${executionResults.length} successful`,
    );

    return {
      dealId: config.deal.id,
      results: executionResults,
      summary: {
        totalMethods: executionResults.length,
        successfulMethods: successfulResults.length,
        failedMethods: executionResults.length - successfulResults.length,
        fastestMethod: fastestResult?.method,
        fastestLatency: fastestResult?.metrics.latency,
      },
      testedAt: new Date(),
    };
  }

  /**
   * Execute a single retrieval with metrics and validation
   * @private
   */
  private async executeRetrieval(
    urlResult: RetrievalUrlResult,
    config: RetrievalConfiguration,
  ): Promise<RetrievalExecutionResult> {
    const strategy = this.addons.get(urlResult.method);

    if (!strategy) {
      throw new Error(`Strategy ${urlResult.method} not found`);
    }

    try {
      let result: RequestWithMetrics<Buffer>;
      try {
        result = await this.httpClientService.requestWithRandomProxyAndMetrics<Buffer>(urlResult.url);
      } catch (error) {
        if (error.message === "No proxy available") {
          result = await this.httpClientService.requestWithoutProxyAndMetrics<Buffer>(urlResult.url);
        } else {
          throw error;
        }
      }

      // Preprocess data if strategy supports it
      let processedData = result.data;
      if (strategy.preprocessRetrievedData) {
        processedData = await strategy.preprocessRetrievedData(result.data);
      }

      // Validate data if strategy supports it
      let validation = {} as ValidationResult;
      if (strategy.validateData) {
        try {
          validation = await strategy.validateData(processedData, config);
        } catch (error) {
          this.logger.warn(`Validation failed for ${urlResult.method}: ${error.message}`);
          validation = {
            isValid: false,
            method: "validation-error",
            details: error.message,
          };
        }
      }

      const throughput = result.metrics.responseSize / (result.metrics.totalTime / 1000);

      return {
        url: urlResult.url,
        method: urlResult.method,
        data: processedData,
        metrics: {
          latency: result.metrics.totalTime,
          ttfb: result.metrics.ttfb,
          throughput,
          statusCode: result.metrics.statusCode,
          timestamp: result.metrics.timestamp,
          responseSize: result.metrics.responseSize,
        },
        validation,
        success: true,
      };
    } catch (error) {
      this.logger.error(`Retrieval failed for ${urlResult.method}: ${error.message}`, error.stack);

      return {
        url: urlResult.url,
        method: urlResult.method,
        data: Buffer.alloc(0),
        metrics: {
          latency: 0,
          ttfb: 0,
          throughput: 0,
          statusCode: 0,
          timestamp: new Date(),
          responseSize: 0,
        },
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get information about all registered retrieval add-ons
   * Useful for debugging and monitoring
   *
   * @returns Array of add-on information
   */
  getRegisteredAddons(): Array<{ name: string; priority: number }> {
    return Array.from(this.addons.values()).map((addon) => ({
      name: addon.name,
      priority: addon.priority,
    }));
  }

  /**
   * Check if a specific retrieval add-on is registered
   *
   * @param addonName - Name of the add-on to check
   * @returns true if add-on is registered
   */
  isAddonRegistered(addonName: string): boolean {
    return this.addons.has(addonName);
  }

  /**
   * Get expected metrics for a specific retrieval method
   *
   * @param methodName - Name of the retrieval method
   * @returns Expected metrics or null if not available
   */
  getExpectedMetrics(methodName: string) {
    const addon = this.addons.get(methodName);
    return addon?.getExpectedMetrics?.() || null;
  }
}
