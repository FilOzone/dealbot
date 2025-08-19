import { Injectable, Inject, Logger } from "@nestjs/common";
import { Retrieval } from "../domain/entities/retrieval.entity";
import { RetrievalStatus } from "../domain/enums/deal-status.enum";
import type { IDealRepository, IRetrievalRepository } from "../domain/interfaces/repositories.interface";
import { RetrievalResult } from "../domain/interfaces/external-services.interface";
import { CDN_HOSTNAME } from "../common/constants";
import { getProvider } from "../common/providers";
import { type Hex } from "../common/types";
import { Deal } from "../domain/entities/deal.entity";

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    @Inject("IDealRepository")
    private readonly dealRepository: IDealRepository,
    @Inject("IRetrievalRepository")
    private readonly retrievalRepository: IRetrievalRepository,
  ) {}

  async getMetrics(startDate: Date, endDate: Date) {
    return this.retrievalRepository.getMetrics(startDate, endDate);
  }

  async comparePerformance(startDate: Date, endDate: Date) {
    const metrics = await this.getMetrics(startDate, endDate);

    const comparison = {
      cdnImprovement: {
        latency:
          ((metrics.cdnVsDirectComparison.direct.avgLatency - metrics.cdnVsDirectComparison.cdn.avgLatency) /
            metrics.cdnVsDirectComparison.direct.avgLatency) *
          100,
        successRate: metrics.cdnVsDirectComparison.cdn.successRate - metrics.cdnVsDirectComparison.direct.successRate,
      },
      recommendation: "",
    };

    if (comparison.cdnImprovement.latency > 20) {
      comparison.recommendation = "CDN provides significant performance improvement";
    } else if (comparison.cdnImprovement.latency < 0) {
      comparison.recommendation = "Direct retrieval performs better than CDN";
    } else {
      comparison.recommendation = "CDN provides marginal improvement";
    }

    return comparison;
  }

  async performRandomBatchRetrievals(count: number): Promise<Retrieval[]> {
    const deals = await this.selectRandomDealsForRetrieval(count);
    const totalDeals = deals.length;

    this.logger.log(`Starting parallel retrieval tests for ${totalDeals} deals`);

    // Process retrievals in parallel with controlled concurrency
    const results = await this.processRetrievalsInParallel(deals);

    const successfulRetrievals = results.filter((result) => result.success).map((result) => result.retrieval!);
    const failedCount = results.filter((result) => !result.success).length;

    this.logger.log(`Retrieval tests completed: ${successfulRetrievals.length} successful, ${failedCount} failed`);

    return successfulRetrievals;
  }

  private async processRetrievalsInParallel(
    deals: Deal[],
    maxConcurrency: number = 5,
  ): Promise<Array<{ success: boolean; retrieval?: Retrieval; error?: string; dealId: string }>> {
    const results: Array<{ success: boolean; retrieval?: Retrieval; error?: string; dealId: string }> = [];

    // Process deals in batches to control concurrency (lower than deal creation due to network I/O)
    for (let i = 0; i < deals.length; i += maxConcurrency) {
      const batch = deals.slice(i, i + maxConcurrency);

      const batchPromises = batch.map((deal) => this.performRetrieval(deal));
      const batchResults = await Promise.allSettled(batchPromises);

      // Process batch results
      batchResults.forEach((result, index) => {
        const deal = batch[index];

        if (result.status === "fulfilled") {
          results.push({
            success: true,
            retrieval: result.value,
            dealId: deal.dealId,
          });
        } else {
          const errorMessage = result.reason?.message || "Unknown error";
          results.push({
            success: false,
            error: errorMessage,
            dealId: deal.dealId,
          });

          this.logger.warn(`Retrieval failed for deal ${deal.dealId}: ${errorMessage}`);
        }
      });
    }

    return results;
  }

  private async performRetrieval(deal: Deal): Promise<Retrieval> {
    const retrieval = new Retrieval({
      cid: deal.cid,
      storageProvider: deal.storageProvider,
      withCDN: deal.withCDN,
      status: RetrievalStatus.PENDING,
      startTime: new Date(),
    });

    const savedRetrieval = await this.retrievalRepository.create(retrieval);

    try {
      const url = this.constructRetrievalUrl(deal.withCDN, deal.walletAddress, deal.cid, deal.storageProvider);
      this.logger.log(`Retrieving from URL: ${url} for deal id: ${deal.dealId}`);
      savedRetrieval.status = RetrievalStatus.IN_PROGRESS;
      await this.retrievalRepository.update(savedRetrieval.id, {
        status: RetrievalStatus.IN_PROGRESS,
      });

      let result: RetrievalResult;
      result = await this.retrieve(url);

      savedRetrieval.endTime = new Date();
      savedRetrieval.calculateLatency();
      savedRetrieval.responseCode = result.responseCode;

      if (result.success) {
        savedRetrieval.status = RetrievalStatus.SUCCESS;
        savedRetrieval.bytesRetrieved = result.data?.length || 0;
        savedRetrieval.throughput = result.throughput;
        savedRetrieval.calculateThroughput();
      } else {
        savedRetrieval.status = RetrievalStatus.FAILED;
        savedRetrieval.errorMessage = result.error;
      }

      await this.retrievalRepository.update(savedRetrieval.id, {
        status: savedRetrieval.status,
        endTime: savedRetrieval.endTime,
        latency: savedRetrieval.latency,
        bytesRetrieved: savedRetrieval.bytesRetrieved,
        throughput: savedRetrieval.throughput,
        errorMessage: savedRetrieval.errorMessage,
        responseCode: savedRetrieval.responseCode,
      });

      this.logger.log(
        `Retrieval ${savedRetrieval.id} completed: ${savedRetrieval.status}, ` + `Latency: ${savedRetrieval.latency}ms`,
      );

      return savedRetrieval;
    } catch (error) {
      this.logger.error(`Retrieval failed for deal ${deal.dealId}`, error);

      await this.retrievalRepository.update(savedRetrieval.id, {
        status: RetrievalStatus.FAILED,
        endTime: new Date(),
        errorMessage: error.message,
      });

      throw error;
    }
  }

  private async retrieve(url: string): Promise<RetrievalResult> {
    const startTime = Date.now();

    try {
      this.logger.debug(`Starting retrieval from URL: ${url}`);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": "Filecoin-Deal-Bot/1.0",
        },
      });

      if (!response.ok) {
        const endTime = Date.now();
        const latency = endTime - startTime;

        return {
          success: false,
          latency,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      // Read response as buffer
      const arrayBuffer = await response.arrayBuffer();
      const data = Buffer.from(arrayBuffer);
      const endTime = Date.now();

      // Calculate metrics
      const latency = endTime - startTime;
      const bytesRetrieved = data.length;
      const throughput = latency > 0 ? bytesRetrieved / (latency / 1000) : 0; // bytes per second

      this.logger.debug(
        `Retrieval successful: ${bytesRetrieved} bytes in ${latency}ms (${throughput.toFixed(2)} bytes/sec)`,
      );

      return {
        success: true,
        data,
        latency,
        throughput,
        responseCode: response.status,
      };
    } catch (error) {
      const endTime = Date.now();
      const latency = endTime - startTime;

      let errorMessage = "Unknown error";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      }

      this.logger.error(`Retrieval failed for URL ${url}: ${errorMessage}`);

      return {
        success: false,
        latency,
        error: errorMessage,
      };
    }
  }

  private async selectRandomDealsForRetrieval(count: number): Promise<Deal[]> {
    const allDeals = await this.dealRepository.findRecentCompletedDeals(Math.max(count * 2, 100));

    if (allDeals.length === 0) {
      this.logger.warn("No recent deals found for retrieval testing");
      return [];
    }

    // Group and shuffle deals by provider
    const dealsByProvider = new Map<string, Deal[]>();

    for (const deal of allDeals) {
      if (!dealsByProvider.has(deal.storageProvider)) {
        dealsByProvider.set(deal.storageProvider, []);
      }
      dealsByProvider.get(deal.storageProvider)!.push(deal);
    }

    // Shuffle deals within each provider
    for (const [provider, deals] of dealsByProvider) {
      this.shuffleArray(deals);
    }

    const selectedDeals: Deal[] = [];
    const providers = Array.from(dealsByProvider.keys());

    // Calculate how many deals per provider for balanced distribution
    const dealsPerProvider = Math.ceil(count / providers.length);

    for (const provider of providers) {
      const providerDeals = dealsByProvider.get(provider)!;
      const dealsToTake = Math.min(dealsPerProvider, providerDeals.length, count - selectedDeals.length);

      selectedDeals.push(...providerDeals.slice(0, dealsToTake));

      if (selectedDeals.length >= count) break;
    }

    // If we still need more deals, randomly select from remaining
    if (selectedDeals.length < count) {
      const remainingDeals = Array.from(dealsByProvider.values())
        .flat()
        .filter((deal) => !selectedDeals.includes(deal));

      this.shuffleArray(remainingDeals);
      selectedDeals.push(...remainingDeals.slice(0, count - selectedDeals.length));
    }

    this.logger.debug(
      `Selected ${selectedDeals.length} deals from ${new Set(selectedDeals.map((d) => d.storageProvider)).size} providers`,
    );

    return selectedDeals;
  }

  private constructRetrievalUrl(withCDN: boolean, walletAddress: string, cid: string, storageProvider: Hex) {
    if (withCDN) {
      return `https://${walletAddress.toLowerCase()}.${CDN_HOSTNAME}/${cid}`;
    } else {
      const providerDetails = getProvider(storageProvider);
      return `${providerDetails.serviceUrl.replace(/\/$/, "")}/piece/${cid}`;
    }
  }

  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }
}
