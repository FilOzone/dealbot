import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import type { Hex } from "../common/types.js";
import { Deal } from "../database/entities/deal.entity.js";
import { Retrieval } from "../database/entities/retrieval.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { DealStatus, RetrievalStatus } from "../database/types.js";
import {
  buildCheckMetricLabels,
  type CheckMetricLabels,
  classifyFailureStatus,
} from "../metrics/utils/check-metric-labels.js";
import { RetrievalCheckMetrics } from "../metrics/utils/check-metrics.service.js";
import { RetrievalAddonsService } from "../retrieval-addons/retrieval-addons.service.js";
import type {
  RetrievalConfiguration,
  RetrievalExecutionResult,
  RetrievalTestResult,
} from "../retrieval-addons/types.js";

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    private readonly retrievalAddonsService: RetrievalAddonsService,
    @InjectRepository(Deal)
    private readonly dealRepository: Repository<Deal>,
    @InjectRepository(Retrieval)
    private readonly retrievalRepository: Repository<Retrieval>,
    @InjectRepository(StorageProvider)
    private readonly spRepository: Repository<StorageProvider>,
    private readonly retrievalMetrics: RetrievalCheckMetrics,
  ) {}

  async performRandomBatchRetrievals(count: number, signal?: AbortSignal): Promise<Retrieval[]> {
    const deals = await this.selectRandomDealsForRetrieval(count);
    const totalDeals = deals.length;

    if (totalDeals === 0) {
      this.logger.warn("No deals available for retrieval testing");
      return [];
    }

    this.logger.log(`Starting retrieval tests for ${totalDeals} deals`);

    const results = await this.processRetrievalsInParallel(deals, {
      maxConcurrency: 10,
      signal,
    });

    const allRetrievals = results.flat();
    const successfulRetrievals = allRetrievals.filter((r) => r.status === RetrievalStatus.SUCCESS);

    this.logger.log(`Retrieval tests completed: ${successfulRetrievals.length}/${allRetrievals.length} successful`);

    return allRetrievals;
  }

  async performRandomRetrievalForProvider(spAddress: string, signal?: AbortSignal): Promise<Retrieval[]> {
    const deal = await this.selectRandomSuccessfulDealForProvider(spAddress);
    if (!deal) {
      this.logger.warn(`No successful deals available for ${spAddress}, skipping retrieval`);
      return [];
    }

    this.logger.log(`Starting retrieval test for ${spAddress}`);

    return this.performAllRetrievals(deal, signal);
  }

  async performRetrievalsForDeal(deal: Deal, signal?: AbortSignal): Promise<Retrieval[]> {
    return this.performAllRetrievals(deal, signal);
  }

  // ============================================================================
  // Parallel Processing
  // ============================================================================

  private async processRetrievalsInParallel(
    deals: Deal[],
    {
      maxConcurrency = 10,
      signal,
    }: {
      maxConcurrency?: number;
      signal?: AbortSignal;
    },
  ): Promise<Retrieval[][]> {
    const results: Retrieval[][] = [];
    for (let i = 0; i < deals.length; i += maxConcurrency) {
      if (signal?.aborted) {
        this.logger.warn("Retrieval job aborted. Skipping remaining deals.");
        break;
      }

      const batch = deals.slice(i, i + maxConcurrency);
      const batchPromises = batch.map((deal) => this.performAllRetrievals(deal, signal));

      const batchResults = await Promise.allSettled(batchPromises);

      // Process results
      for (let index = 0; index < batchResults.length; index++) {
        const result = batchResults[index];
        const deal = batch[index];
        if (result.status === "fulfilled") {
          results.push(result.value);
        } else {
          if (!signal?.aborted) {
            const errorReason = result.reason;
            const errorMessage =
              errorReason instanceof Error ? errorReason.message : String(errorReason ?? "Unknown error");
            this.logger.error(`Batch retrieval failed for deal ${deal?.id || "unknown"}: ${errorMessage}`);
          }
        }
      }

      if (signal?.aborted) {
        this.logger.warn("Retrieval job aborted after batch completion. Skipping remaining deals.");
        break;
      }
    }

    return results;
  }

  // ============================================================================
  // Retrieval Execution
  // ============================================================================

  private async performAllRetrievals(deal: Deal, signal?: AbortSignal): Promise<Retrieval[]> {
    signal?.throwIfAborted();

    const provider = await this.findStorageProvider(deal.spAddress);
    if (!provider) {
      throw new Error(`Storage provider ${deal.spAddress} not found`);
    }
    const providerLabels = buildCheckMetricLabels({
      checkType: "retrieval",
      providerId: provider.providerId,
      providerIsApproved: provider.isApproved,
    });

    const config: RetrievalConfiguration = {
      deal,
      walletAddress: deal.walletAddress as Hex,
      storageProvider: deal.spAddress as Hex,
    };

    let testResult: RetrievalTestResult;
    let retrievals: Retrieval[];
    const retrievalCheckStartTime = Date.now();
    this.retrievalMetrics.recordStatus(providerLabels, "pending");
    try {
      testResult = await this.retrievalAddonsService.testAllRetrievalMethods(config, signal);

      retrievals = await Promise.all(
        testResult.results.map((executionResult) =>
          this.createRetrievalFromResult(deal, executionResult, providerLabels),
        ),
      );

      const successCount = retrievals.filter((r) => r.status === RetrievalStatus.SUCCESS).length;
      this.logger.log(`Retrievals for ${deal.pieceCid}: ${successCount}/${retrievals.length} successful`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (signal?.aborted) {
        const abortReason = signal.reason;
        const abortMessage = abortReason instanceof Error ? abortReason.message : String(abortReason ?? "");
        this.logger.warn(`Retrievals aborted for ${deal.pieceCid}: ${abortMessage || errorMessage}`);
      } else {
        this.logger.error(`All retrievals failed for ${deal.pieceCid}: ${errorMessage}`);
        this.retrievalMetrics.recordStatus(providerLabels, classifyFailureStatus(error));
      }

      // Don't try to record timeouts here. If this catch block fires, it's either:
      // 1. The batch timeout fired because we're out of time (global deadline) - don't record
      // 2. A catastrophic error occurred (provider not found, etc.) - re-throw for logging
      // 3. Individual HTTP timeouts are captured by Promise.allSettled in testAllRetrievalMethods
      //    and converted to FAILED records through the normal flow
      //
      // This ensures we don't create duplicate/inaccurate TIMEOUT records when HTTP requests
      // are still running in the background after batch timeout fires.

      throw error;
    }

    if (testResult.aborted || signal?.aborted) {
      const abortReason = signal?.reason;
      const abortMessage = abortReason instanceof Error ? abortReason.message : String(abortReason ?? "");
      this.logger.warn(
        `Retrieval job aborted after testing for ${deal.pieceCid}; recorded partial results.` +
          (abortMessage ? ` Reason: ${abortMessage}` : ""),
      );
      return retrievals;
    }

    const retrievalCheckDurationMs = Date.now() - retrievalCheckStartTime;
    this.retrievalMetrics.observeCheckDuration(providerLabels, retrievalCheckDurationMs);
    this.retrievalMetrics.recordStatus(
      providerLabels,
      retrievals.every((retrieval) => retrieval.status === RetrievalStatus.SUCCESS) ? "success" : "failure.other",
    );

    return retrievals;
  }

  private async createRetrievalFromResult(
    deal: Deal,
    executionResult: RetrievalExecutionResult,
    providerLabels: CheckMetricLabels,
  ): Promise<Retrieval> {
    const retrieval = this.retrievalRepository.create({
      dealId: deal.id,
      status: executionResult.success ? RetrievalStatus.SUCCESS : RetrievalStatus.FAILED,
      retrievalEndpoint: executionResult.url || "N/A",
      serviceType: executionResult.method,
    });

    if (executionResult.success) {
      this.mapExecutionResultToRetrieval(retrieval, executionResult);
      this.recordRetrievalEventMetrics(executionResult, providerLabels);
    } else {
      retrieval.completedAt = new Date();
      retrieval.startedAt = new Date();
      retrieval.errorMessage = executionResult.error || "Unknown error";
      this.retrievalMetrics.recordHttpResponseCode(providerLabels, executionResult.metrics.statusCode);
    }

    return this.saveRetrieval(retrieval);
  }

  private recordRetrievalEventMetrics(
    executionResult: RetrievalExecutionResult,
    providerLabels: CheckMetricLabels,
  ): void {
    if (!executionResult.success) return;

    this.retrievalMetrics.observeFirstByteMs(providerLabels, executionResult.metrics.ttfb);
    this.retrievalMetrics.observeLastByteMs(providerLabels, executionResult.metrics.latency);
    this.retrievalMetrics.observeThroughput(providerLabels, executionResult.metrics.throughput);
    this.retrievalMetrics.recordHttpResponseCode(providerLabels, executionResult.metrics.statusCode);
  }

  // ============================================================================
  // Retrieval Helpers
  // ============================================================================

  private mapExecutionResultToRetrieval(retrieval: Retrieval, executionResult: RetrievalExecutionResult): void {
    retrieval.startedAt = executionResult.metrics.timestamp;
    retrieval.completedAt = executionResult.metrics.timestamp;
    retrieval.latencyMs = Math.round(executionResult.metrics.latency);
    retrieval.ttfbMs = Math.round(executionResult.metrics.ttfb);
    retrieval.responseCode = executionResult.metrics.statusCode;
    retrieval.bytesRetrieved = executionResult.metrics.responseSize;
    retrieval.throughputBps = Math.round(executionResult.metrics.throughput);
    retrieval.retryCount = executionResult.retryCount || 0;
  }

  private async saveRetrieval(retrieval: Retrieval): Promise<Retrieval> {
    try {
      return await this.retrievalRepository.save(retrieval);
    } catch (error) {
      this.logger.warn(`Failed to save retrieval: ${error.message}`);
      return retrieval;
    }
  }

  private async findStorageProvider(address: string): Promise<StorageProvider | null> {
    return this.spRepository.findOne({ where: { address } });
  }

  // ============================================================================
  // Deal Selection
  // ============================================================================

  private async selectRandomDealsForRetrieval(count: number): Promise<Deal[]> {
    const allDeals = await this.dealRepository.find({
      where: [{ status: DealStatus.DEAL_CREATED }, { status: DealStatus.PIECE_ADDED }],
      order: { createdAt: "DESC" },
      take: Math.max(count * 2, 100),
    });

    if (allDeals.length === 0) {
      this.logger.warn("No deals available for retrieval testing");
      return [];
    }

    const dealsByProvider = this.groupDealsByProvider(allDeals);
    const selectedDeals = this.selectBalancedDeals(dealsByProvider, count);

    return selectedDeals;
  }

  /**
   * We select a random successful deal (DEAL_CREATED only) for a given provider.
   * Uses Postgres ORDER BY RANDOM() since Dealbot is Postgres-only.
   */
  private async selectRandomSuccessfulDealForProvider(spAddress: string): Promise<Deal | null> {
    return this.dealRepository
      .createQueryBuilder("deal")
      .where("deal.sp_address = :spAddress", { spAddress })
      .andWhere("deal.status IN (:...statuses)", {
        statuses: [DealStatus.DEAL_CREATED],
      })
      .orderBy("RANDOM()")
      .limit(1)
      .getOne();
  }

  private groupDealsByProvider(deals: Deal[]): Map<string, Deal[]> {
    const dealsByProvider = new Map<string, Deal[]>();

    for (const deal of deals) {
      if (!dealsByProvider.has(deal.spAddress)) {
        dealsByProvider.set(deal.spAddress, []);
      }
      dealsByProvider.get(deal.spAddress)!.push(deal);
    }

    // Shuffle deals within each provider
    for (const deals of dealsByProvider.values()) {
      this.shuffleArray(deals);
    }

    return dealsByProvider;
  }

  private selectBalancedDeals(dealsByProvider: Map<string, Deal[]>, count: number): Deal[] {
    const selectedDeals: Deal[] = [];
    const providers = Array.from(dealsByProvider.keys());
    const dealsPerProvider = Math.ceil(count / providers.length);

    for (const provider of providers) {
      const providerDeals = dealsByProvider.get(provider)!;
      const dealsToTake = Math.min(dealsPerProvider, providerDeals.length, count - selectedDeals.length);

      selectedDeals.push(...providerDeals.slice(0, dealsToTake));

      if (selectedDeals.length >= count) break;
    }

    // Fill remaining slots if needed
    if (selectedDeals.length < count) {
      const remainingDeals = Array.from(dealsByProvider.values())
        .flat()
        .filter((deal) => !selectedDeals.includes(deal));

      this.shuffleArray(remainingDeals);
      selectedDeals.push(...remainingDeals.slice(0, count - selectedDeals.length));
    }

    return selectedDeals;
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }
}
