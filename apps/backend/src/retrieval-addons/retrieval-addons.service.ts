import { Injectable, Logger } from "@nestjs/common";
import { RetrievalError, type RetrievalErrorResponseInfo } from "../common/errors.js";
import { ServiceType } from "../database/types.js";
import { HttpClientService } from "../http-client/http-client.service.js";
import type { RequestWithMetrics } from "../http-client/types.js";
import type { IRetrievalAddon } from "./interfaces/retrieval-addon.interface.js";
import { CdnRetrievalStrategy } from "./strategies/cdn.strategy.js";
import { DirectRetrievalStrategy } from "./strategies/direct.strategy.js";
import { IpniRetrievalStrategy } from "./strategies/ipni.strategy.js";
import type {
  RetrievalConfiguration,
  RetrievalExecutionResult,
  RetrievalTestResult,
  RetrievalUrlResult,
  ValidationResult,
} from "./types.js";

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
  async performRetrieval(config: RetrievalConfiguration, signal?: AbortSignal): Promise<RetrievalExecutionResult> {
    const urlResult = this.constructPreferredUrl(config);

    this.logger.log(`Performing retrieval for deal ${config.deal.id} using ${urlResult.method}: ${urlResult.url}`);

    return await this.executeRetrieval(urlResult, config, signal);
  }

  /**
   * Test all applicable retrieval methods for a deal
   * Executes retrievals in parallel and compares results
   *
   * @param config - Retrieval configuration
   * @returns Test result with all method results and summary
   */
  async testAllRetrievalMethods(config: RetrievalConfiguration, signal?: AbortSignal): Promise<RetrievalTestResult> {
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
    const retrievalPromises = urlResults.map((urlResult) =>
      this.executeRetrievalWithRetries(urlResult, config, signal),
    );

    const results = await Promise.allSettled(retrievalPromises);

    // Process results
    const executionResults: RetrievalExecutionResult[] = results.map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      } else {
        // Create failed result - retryCount unknown for catastrophic failures
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
          retryCount: undefined, // Unknown for catastrophic failures
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
   * Execute retrieval with retries based on strategy configuration
   * Strategies can define retry behavior (e.g., CDN cache warming)
   *
   * @param urlResult - URL result from strategy
   * @param config - Retrieval configuration
   * @returns Best execution result from all attempts
   * @private
   */
  private async executeRetrievalWithRetries(
    urlResult: RetrievalUrlResult,
    config: RetrievalConfiguration,
    signal?: AbortSignal,
  ): Promise<RetrievalExecutionResult> {
    const strategy = this.addons.get(urlResult.method);

    if (!strategy) {
      throw new Error(`Strategy ${urlResult.method} not found`);
    }

    // Get retry configuration from strategy (default: single attempt)
    const retryConfig = strategy.getRetryConfig?.() || {
      attempts: 1,
      delayMs: 0,
    };
    const { attempts, delayMs } = retryConfig;

    if (attempts > 1) {
      this.logger.debug(`${strategy.name}: performing ${attempts} attempts with ${delayMs}ms delay`);
    }

    const results: Array<RetrievalExecutionResult & { attemptNumber: number }> = [];

    for (let attempt = 1; attempt <= attempts; attempt++) {
      this.ensureNotAborted(signal);
      try {
        const result = await this.executeRetrieval(urlResult, config, signal);
        results.push({ ...result, attemptNumber: attempt });

        if (attempts > 1 && result.success) {
          const attemptType = attempt === 1 ? "initial" : "retry";
          this.logger.log(
            `${strategy.name} attempt ${attempt}/${attempts} (${attemptType}): ` +
              `${result.metrics.latency}ms latency, ${result.metrics.ttfb}ms TTFB`,
          );
        }

        // Add delay between attempts if configured
        if (attempt < attempts && delayMs > 0) {
          this.ensureNotAborted(signal);
          await this.delay(delayMs);
        }
      } catch (error) {
        this.logger.warn(`${strategy.name} attempt ${attempt}/${attempts} failed: ${error.message}`);

        // If all attempts fail, throw the error
        if (attempt === attempts) {
          throw error;
        }
      }
    }

    // Return the best result (lowest latency from successful attempts)
    const successfulResults = results.filter((r) => r.success);

    if (successfulResults.length === 0) {
      const lastResult = results[results.length - 1];
      return { ...lastResult, retryCount: lastResult.attemptNumber - 1 }; // Return last attempt if all failed
    }

    const bestResult = successfulResults.reduce((best, current) =>
      current.metrics.latency < best.metrics.latency ? current : best,
    );

    if (attempts > 1) {
      this.logger.log(
        `${strategy.name} best result: ${bestResult.metrics.latency}ms latency ` +
          `(from ${successfulResults.length}/${attempts} successful attempts, attempt #${bestResult.attemptNumber})`,
      );
    }

    // Add retry count (0 = first attempt, 1+ = retries needed)
    return { ...bestResult, retryCount: bestResult.attemptNumber - 1 };
  }

  /**
   * Delay helper for CDN cache warming
   * @param ms - Milliseconds to delay
   * @private
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Execute a single retrieval with metrics and validation
   * @private
   */
  private async executeRetrieval(
    urlResult: RetrievalUrlResult,
    config: RetrievalConfiguration,
    signal?: AbortSignal,
  ): Promise<RetrievalExecutionResult> {
    const strategy = this.addons.get(urlResult.method);

    if (!strategy) {
      throw new Error(`Strategy ${urlResult.method} not found`);
    }

    try {
      this.ensureNotAborted(signal);
      let result: RequestWithMetrics<Buffer>;
      try {
        // TODO: use proxy for IPFS_PIN as well
        if (urlResult.method === ServiceType.IPFS_PIN) {
          result = await this.httpClientService.requestWithoutProxyAndMetrics<Buffer>(urlResult.url, {
            headers: urlResult.headers,
            httpVersion: urlResult.httpVersion,
            signal,
          });
        } else {
          result = await this.httpClientService.requestWithRandomProxyAndMetrics<Buffer>(urlResult.url, {
            headers: urlResult.headers,
            httpVersion: urlResult.httpVersion,
            signal,
          });
        }
      } catch (error) {
        if (error.message === "No proxy available") {
          result = await this.httpClientService.requestWithoutProxyAndMetrics<Buffer>(urlResult.url, {
            headers: urlResult.headers,
            httpVersion: urlResult.httpVersion,
            signal,
          });
        } else {
          throw error;
        }
      }

      // Validate HTTP status code before processing (must be 2xx for success)
      if (result.metrics.statusCode < 200 || result.metrics.statusCode >= 300) {
        const responsePreview = this.buildResponsePreview(result.data);
        throw RetrievalError.fromHttpResponse(result.metrics.statusCode, responsePreview);
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
          // Log additional context if validation failed, including the URL used
          if (!validation.isValid) {
            this.logger.warn(
              `Validation failed for ${urlResult.method} retrieval of deal ${config.deal.id}: ` +
                `URL: ${urlResult.url}, ` +
                `Status: ${result.metrics.statusCode}, ` +
                `Response Size: ${result.metrics.responseSize} bytes, ` +
                `Details: ${validation.details || "unknown"}`,
            );
          }
        } catch (error) {
          this.logger.warn(
            `Validation error for ${urlResult.method} retrieval of deal ${config.deal.id}: ` +
              `URL: ${urlResult.url}, ` +
              `Error: ${error.message}`,
          );
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const responseInfo = this.extractResponseInfo(error);
      const errorCode = this.extractErrorCode(error);
      const context = this.formatRetrievalContext(config, urlResult, { ...responseInfo, errorCode });

      this.logger.error(`Retrieval failed for ${urlResult.method}: ${errorMessage} (${context})`, errorStack);

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

  private ensureNotAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new Error("Retrieval job aborted");
    }
  }

  private formatRetrievalContext(
    config: RetrievalConfiguration,
    urlResult: RetrievalUrlResult,
    extras?: RetrievalErrorResponseInfo & { errorCode?: string },
  ): string {
    const pieceCid = config.deal.pieceCid ?? "missing";
    const headerKeys = urlResult.headers ? Object.keys(urlResult.headers) : [];
    const hasAuthHeader = headerKeys.includes("Authorization");

    const parts = [
      `deal=${config.deal.id}`,
      `piece=${pieceCid}`,
      `sp=${config.storageProvider}`,
      `url=${urlResult.url}`,
      `http=${urlResult.httpVersion ?? "1.1"}`,
      `headers=${headerKeys.length ? headerKeys.join(",") : "none"}`,
      `auth=${hasAuthHeader ? "yes" : "no"}`,
    ];

    if (extras?.statusCode !== undefined) {
      parts.push(`status=${extras.statusCode}`);
    }

    if (extras?.errorCode) {
      parts.push(`code=${extras.errorCode}`);
    }

    if (extras?.responsePreview) {
      parts.push(`response="${extras.responsePreview}"`);
    }

    return parts.join(" ");
  }

  private extractResponseInfo(error: unknown): RetrievalErrorResponseInfo {
    if (error instanceof RetrievalError) {
      return error.responseInfo ?? {};
    }

    if (!error || typeof error !== "object") {
      return {};
    }

    // Handle axios-style errors with response object
    const response = (error as { response?: { status?: number; data?: unknown } }).response;
    if (!response) {
      return {};
    }

    return {
      statusCode: typeof response.status === "number" ? response.status : undefined,
      responsePreview: this.buildResponsePreview(response.data),
    };
  }

  private extractErrorCode(error: unknown): string | undefined {
    if (error instanceof RetrievalError) {
      return error.code;
    }

    if (!error || typeof error !== "object") {
      return undefined;
    }

    // Handle generic errors with code property (e.g., Node.js system errors)
    const code = (error as { code?: string }).code;
    return typeof code === "string" && code.length > 0 ? code : undefined;
  }

  private buildResponsePreview(payload: unknown, maxLength: number = 200): string | undefined {
    if (payload === undefined || payload === null) {
      return undefined;
    }

    try {
      let text = "";

      if (Buffer.isBuffer(payload)) {
        text = payload.toString("utf8", 0, Math.min(payload.length, maxLength));
      } else if (payload instanceof ArrayBuffer) {
        const buffer = Buffer.from(payload);
        text = buffer.toString("utf8", 0, Math.min(buffer.length, maxLength));
      } else if (typeof payload === "string") {
        text = payload.slice(0, maxLength);
      } else {
        text = JSON.stringify(payload).slice(0, maxLength);
      }

      const sanitized = text.replace(/\s+/g, " ").trim();
      if (sanitized.length === 0) {
        return undefined;
      }

      return sanitized.replace(/"/g, "'");
    } catch {
      return undefined;
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
