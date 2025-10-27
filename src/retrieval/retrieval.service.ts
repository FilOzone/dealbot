import { Injectable, Logger } from "@nestjs/common";
import { DealStatus, RetrievalStatus, ServiceType } from "../database/types.js";
import { Deal } from "../database/entities/deal.entity.js";
import { Retrieval } from "../database/entities/retrieval.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { RetrievalAddonsService } from "../retrieval-addons/retrieval-addons.service.js";
import type { RetrievalConfiguration, RetrievalExecutionResult } from "../retrieval-addons/types.js";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Hex } from "../common/types.js";

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
  ) {}

  async performRandomBatchRetrievals(count: number): Promise<Retrieval[]> {
    const deals = await this.selectRandomDealsForRetrieval(count);
    const totalDeals = deals.length;

    this.logger.log(`Starting retrieval tests for ${totalDeals} deals`);

    const results = await this.processRetrievalsInParallel(deals);

    const allRetrievals = results.flat();
    const successfulRetrievals = allRetrievals.filter((r) => r.status === RetrievalStatus.SUCCESS);

    this.logger.log(`Retrieval tests completed: ${successfulRetrievals.length}/${allRetrievals.length} successful`);

    return allRetrievals;
  }

  // ============================================================================
  // Parallel Processing
  // ============================================================================

  private async processRetrievalsInParallel(deals: Deal[], maxConcurrency: number = 5): Promise<Retrieval[][]> {
    const results: Retrieval[][] = [];

    for (let i = 0; i < deals.length; i += maxConcurrency) {
      const batch = deals.slice(i, i + maxConcurrency);
      const batchPromises = batch.map((deal) => this.performAllRetrievals(deal));
      const batchResults = await Promise.allSettled(batchPromises);

      batchResults.forEach((result) => {
        if (result.status === "fulfilled") {
          results.push(result.value);
        } else {
          this.logger.error(`Batch retrieval failed: ${result.reason?.message}`);
        }
      });
    }

    return results;
  }

  // ============================================================================
  // Retrieval Execution
  // ============================================================================

  private async performAllRetrievals(deal: Deal): Promise<Retrieval[]> {
    const provider = await this.findStorageProvider(deal.spAddress);
    if (!provider) {
      throw new Error(`Storage provider ${deal.spAddress.slice(0, 8)}... not found`);
    }

    const config: RetrievalConfiguration = {
      deal,
      walletAddress: deal.walletAddress as Hex,
      storageProvider: deal.spAddress as Hex,
    };

    try {
      const testResult = await this.retrievalAddonsService.testAllRetrievalMethods(config);

      const retrievals = await Promise.all(
        testResult.results.map((executionResult) => this.createRetrievalFromResult(deal, executionResult)),
      );

      const successCount = retrievals.filter((r) => r.status === RetrievalStatus.SUCCESS).length;
      this.logger.log(
        `Retrievals for ${deal.pieceCid.slice(0, 12)}...: ${successCount}/${retrievals.length} successful`,
      );

      return retrievals;
    } catch (error) {
      this.logger.error(`All retrievals failed for ${deal.pieceCid.slice(0, 12)}...: ${error.message}`);
      throw error;
    }
  }

  private async createRetrievalFromResult(deal: Deal, executionResult: RetrievalExecutionResult): Promise<Retrieval> {
    const retrieval = this.retrievalRepository.create({
      dealId: deal.id,
      status: executionResult.success ? RetrievalStatus.SUCCESS : RetrievalStatus.FAILED,
      retrievalEndpoint: executionResult.url || "N/A",
      serviceType: executionResult.method,
    });

    if (executionResult.success) {
      this.mapExecutionResultToRetrieval(retrieval, executionResult);
    } else {
      retrieval.completedAt = new Date();
      retrieval.startedAt = new Date();
      retrieval.errorMessage = executionResult.error || "Unknown error";
    }

    return this.saveRetrieval(retrieval);
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
    retrieval.bytesRetrieved = executionResult.data.length;
    retrieval.throughputBps = Math.round(executionResult.metrics.throughput);
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
