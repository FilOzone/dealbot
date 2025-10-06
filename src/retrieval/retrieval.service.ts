import { Injectable, Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Retrieval } from "../domain/entities/retrieval.entity.js";
import { RetrievalStatus } from "../domain/enums/deal-status.enum.js";
import type {
  IDealRepository,
  IRetrievalRepository,
  IStorageProviderRepository,
} from "../domain/interfaces/repositories.interface.js";
import type { IMetricsService } from "../domain/interfaces/metrics.interface.js";
import type { RetrievalResult } from "../domain/interfaces/external-services.interface.js";
import { CDN_HOSTNAMES } from "../common/constants.js";
import type { Hex } from "../common/types.js";
import { Deal } from "../domain/entities/deal.entity.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import type { IBlockchainConfig, IConfig } from "../config/app.config.js";

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    private readonly configService: ConfigService<IConfig, true>,
    private walletSdkService: WalletSdkService,
    @Inject("IDealRepository")
    private readonly dealRepository: IDealRepository,
    @Inject("IRetrievalRepository")
    private readonly retrievalRepository: IRetrievalRepository,
    @Inject("IMetricsService")
    private readonly metricsService: IMetricsService,
    @Inject("IStorageProviderRepository")
    private readonly storageProviderRepository: IStorageProviderRepository,
  ) {}

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
            success: result.value?.status === RetrievalStatus.SUCCESS,
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
    });

    const provider = await this.storageProviderRepository.findByAddress(deal.storageProvider);
    if (!provider) {
      throw new Error(`StorageProvider with address ${deal.storageProvider} not found`);
    }

    try {
      const url = this.constructRetrievalUrl(deal.withCDN, deal.walletAddress, deal.cid, deal.storageProvider);
      this.logger.log(`Retrieving from URL: ${url} for deal id: ${deal.dealId}`);
      retrieval.status = RetrievalStatus.IN_PROGRESS;

      const result: RetrievalResult = await this.retrieve(url);

      retrieval.startTime = result.startTime;
      retrieval.endTime = result.endTime;
      retrieval.latency = result.latency;
      retrieval.responseCode = result.responseCode;

      if (result.success) {
        retrieval.status = RetrievalStatus.SUCCESS;
        retrieval.bytesRetrieved = result.data?.length || 0;
        retrieval.throughput = result.throughput;
        retrieval.ttfb = result.ttfb;
      } else {
        retrieval.status = RetrievalStatus.FAILED;
        retrieval.errorMessage = result.error;
      }

      this.logger.log(
        `Retrieval ${retrieval.cid} completed: ${retrieval.status}, ` + `Latency: ${retrieval.latency}ms`,
      );
    } catch (error) {
      this.logger.error(`Retrieval failed for deal ${deal.dealId}`, error);

      retrieval.status = RetrievalStatus.FAILED;
      retrieval.endTime = new Date();
      retrieval.errorMessage = error.message;

      throw error;
    } finally {
      try {
        if (deal.withCDN) {
          const [_, savedRetrieval] = await Promise.all([
            this.metricsService.recordRetrievalMetrics(retrieval),
            this.retrievalRepository.create(retrieval),
          ]);

          return savedRetrieval;
        }

        provider.totalRetrievals += 1;
        if (retrieval.status === RetrievalStatus.SUCCESS) {
          provider.successfulRetrievals += 1;
          provider.averageRetrievalThroughput = this.calculateAvg(
            provider.averageRetrievalThroughput,
            retrieval.throughput || 0,
            provider.successfulRetrievals,
          );
          provider.averageRetrievalLatency = this.calculateAvg(
            provider.averageRetrievalLatency,
            retrieval.latency || 0,
            provider.successfulRetrievals,
          );
          provider.averageRetrievalTTFB = this.calculateAvg(
            provider.averageRetrievalTTFB,
            retrieval.ttfb || 0,
            provider.successfulRetrievals,
          );
        } else {
          provider.failedRetrievals += 1;
        }
        provider.calculateRetrievalSuccessRate();

        const [, , savedRetrieval] = await Promise.all([
          this.storageProviderRepository.update(provider.address, {
            retrievalSuccessRate: provider.retrievalSuccessRate,
            averageRetrievalLatency: provider.averageRetrievalLatency,
            averageRetrievalThroughput: provider.averageRetrievalThroughput,
            averageRetrievalTTFB: provider.averageRetrievalTTFB,
            totalRetrievals: provider.totalRetrievals,
            successfulRetrievals: provider.successfulRetrievals,
            failedRetrievals: provider.failedRetrievals,
          }),
          this.metricsService.recordRetrievalMetrics(retrieval),
          this.retrievalRepository.create(retrieval),
        ]);

        return savedRetrieval;
      } catch (error) {
        this.logger.warn(`Failed to record retrieval metrics: ${error.message}`);

        return retrieval;
      }
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
          ttfb: latency,
          startTime: new Date(startTime),
          endTime: new Date(endTime),
          responseCode: response.status,
        };
      }

      // Validate response body is readable
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Response body is not readable");
      }

      // Read first chunk to measure actual TTFB (time to first data byte)
      const firstChunk = await reader.read();
      const ttfb = Date.now() - startTime;

      // Collect all response data chunks
      const chunks: Uint8Array[] = [];
      if (firstChunk.value) {
        chunks.push(firstChunk.value);
      }

      // Continue reading remaining chunks if response is not complete
      if (!firstChunk.done) {
        let result = await reader.read();
        while (!result.done) {
          chunks.push(result.value);
          result = await reader.read();
        }
      }

      // Efficiently combine all chunks into a single buffer
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const combinedArray = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combinedArray.set(chunk, offset);
        offset += chunk.length;
      }

      const data = Buffer.from(combinedArray);
      const endTime = Date.now();

      // Calculate performance metrics
      const latency = endTime - startTime;
      const bytesRetrieved = data.length;
      const throughput = latency > 0 ? (bytesRetrieved / latency) * 1000 : 0; // bytes per second

      this.logger.debug(
        `Retrieval successful: ${bytesRetrieved} bytes in ${latency}ms, TTFB: ${ttfb}ms, throughput: ${throughput.toFixed(2)} B/s`,
      );

      return {
        success: true,
        data,
        latency,
        ttfb,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        bytesRetrieved,
        throughput,
        responseCode: response.status,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Retrieval failed for URL ${url}: ${errorMessage}`);
      throw error instanceof Error ? error : new Error(errorMessage);
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
    const blockchainConfig = this.configService.get<IBlockchainConfig>("blockchain");
    if (withCDN) {
      return `https://${walletAddress.toLowerCase()}.${CDN_HOSTNAMES[blockchainConfig.network]}/${cid}`;
    } else {
      const providerDetails = this.walletSdkService.getApprovedProviderInfo(storageProvider);

      if (!providerDetails) {
        throw new Error(`Provider ${storageProvider} not approved`);
      }

      if (!providerDetails.products.PDP) {
        throw new Error(`Provider ${storageProvider} does not support PDP`);
      }

      return `${providerDetails.products.PDP.data.serviceURL.replace(/\/$/, "")}/piece/${cid}`;
    }
  }

  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  private calculateAvg(prevAvg: number, newValue: number, count: number): number {
    return prevAvg ? (prevAvg * (count - 1) + newValue) / count : newValue;
  }
}
