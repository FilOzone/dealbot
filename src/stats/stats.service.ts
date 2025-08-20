import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { StorageProviderEntity } from "../infrastructure/database/entities/storage-provider.entity";
import { DailyMetricsEntity } from "../infrastructure/database/entities/daily-metrics.entity";
import { OverallStatsDto, ProviderPerformanceDto } from "./stats.dto";

@Injectable()
export class OverallStatsService {
  private readonly logger = new Logger(OverallStatsService.name);

  constructor(
    @InjectRepository(StorageProviderEntity)
    private readonly storageProviderRepository: Repository<StorageProviderEntity>,
    @InjectRepository(DailyMetricsEntity)
    private readonly dailyMetricsRepository: Repository<DailyMetricsEntity>,
  ) {}

  /**
   * Get overall statistics aggregated from all storage providers
   */
  async getOverallStats(): Promise<OverallStatsDto> {
    try {
      this.logger.debug("Fetching overall statistics");

      const providers = await this.storageProviderRepository.find({
        where: { isActive: true },
      });

      if (providers.length === 0) {
        return this.getEmptyStats();
      }

      const overallStats = this.aggregateProviderStats(providers);
      const providerPerformance = this.mapProviderPerformance(providers);

      return {
        ...overallStats,
        providerPerformance,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch overall stats: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Aggregate statistics across all providers
   */
  private aggregateProviderStats(providers: StorageProviderEntity[]): Omit<OverallStatsDto, "providerPerformance"> {
    const totals = providers.reduce(
      (acc, provider) => ({
        totalDeals: acc.totalDeals + provider.totalDeals,
        totalRetrievals: acc.totalRetrievals + provider.totalRetrievals,
        totalDealsWithCDN: acc.totalDealsWithCDN + provider.totalDealsWithCDN,
        totalDealsWithoutCDN: acc.totalDealsWithoutCDN + provider.totalDealsWithoutCDN,
        successfulDealsWithCDN: acc.successfulDealsWithCDN + provider.successfulDealsWithCDN,
        successfulDealsWithoutCDN: acc.successfulDealsWithoutCDN + provider.successfulDealsWithoutCDN,
        successfulRetrievals: acc.successfulRetrievals + provider.successfulRetrievals,
        totalIngestLatency: acc.totalIngestLatency + (provider.averageIngestLatency || 0),
        totalChainLatency: acc.totalChainLatency + (provider.averageChainLatency || 0),
        totalDealLatency: acc.totalDealLatency + (provider.averageDealLatency || 0),
        totalRetrievalLatency: acc.totalRetrievalLatency + (provider.averageRetrievalLatency || 0),
        totalThroughput: acc.totalThroughput + (provider.averageThroughput || 0),
        providersWithData: acc.providersWithData + (provider.totalDeals > 0 ? 1 : 0),
        providersWithRetrievals: acc.providersWithRetrievals + (provider.totalRetrievals > 0 ? 1 : 0),
      }),
      {
        totalDeals: 0,
        totalRetrievals: 0,
        totalDealsWithCDN: 0,
        totalDealsWithoutCDN: 0,
        successfulDealsWithCDN: 0,
        successfulDealsWithoutCDN: 0,
        successfulRetrievals: 0,
        totalIngestLatency: 0,
        totalChainLatency: 0,
        totalDealLatency: 0,
        totalRetrievalLatency: 0,
        totalThroughput: 0,
        providersWithData: 0,
        providersWithRetrievals: 0,
      },
    );

    // Calculate success rates and averages
    const cdnDealsSuccessRate =
      totals.totalDealsWithCDN > 0 ? (totals.successfulDealsWithCDN / totals.totalDealsWithCDN) * 100 : 0;

    const directDealsSuccessRate =
      totals.totalDealsWithoutCDN > 0 ? (totals.successfulDealsWithoutCDN / totals.totalDealsWithoutCDN) * 100 : 0;

    // For retrieval success rates, we need to calculate based on CDN usage
    // Since we don't have separate retrieval CDN tracking in storage provider entity,
    // we'll use overall retrieval success rate and estimate based on deal patterns
    const overallRetrievalSuccessRate =
      totals.totalRetrievals > 0 ? (totals.successfulRetrievals / totals.totalRetrievals) * 100 : 0;

    return {
      totalDeals: totals.totalDeals,
      totalRetrievals: totals.totalRetrievals,
      totalDealsWithCDN: totals.totalDealsWithCDN,
      totalDealsWithoutCDN: totals.totalDealsWithoutCDN,
      // Estimate retrieval CDN usage based on deal patterns
      totalRetrievalsWithCDN: Math.round(
        totals.totalRetrievals * (totals.totalDealsWithCDN / Math.max(totals.totalDeals, 1)),
      ),
      totalRetrievalsWithoutCDN: Math.round(
        totals.totalRetrievals * (totals.totalDealsWithoutCDN / Math.max(totals.totalDeals, 1)),
      ),
      cdnDealsSuccessRate: Math.round(cdnDealsSuccessRate * 100) / 100,
      directDealsSuccessRate: Math.round(directDealsSuccessRate * 100) / 100,
      cdnRetrievalsSuccessRate: Math.round(overallRetrievalSuccessRate * 100) / 100,
      directRetrievalsSuccessRate: Math.round(overallRetrievalSuccessRate * 100) / 100,
      ingestLatency:
        totals.providersWithData > 0 ? Math.round(totals.totalIngestLatency / totals.providersWithData) : 0,
      chainLatency: totals.providersWithData > 0 ? Math.round(totals.totalChainLatency / totals.providersWithData) : 0,
      dealLatency: totals.providersWithData > 0 ? Math.round(totals.totalDealLatency / totals.providersWithData) : 0,
      retrievalLatency:
        totals.providersWithData > 0 ? Math.round(totals.totalRetrievalLatency / totals.providersWithData) : 0,
      retrievalThroughput:
        totals.providersWithRetrievals > 0 ? Math.round(totals.totalThroughput / totals.providersWithRetrievals) : 0,
    };
  }

  /**
   * Map provider entities to performance DTOs
   */
  private mapProviderPerformance(providers: StorageProviderEntity[]): ProviderPerformanceDto[] {
    return providers.map((provider) => ({
      provider: provider.address,
      totalDeals: provider.totalDeals,
      totalRetrievals: provider.totalRetrievals,
      ingestLatency: Math.round(provider.averageIngestLatency || 0),
      chainLatency: Math.round(provider.averageChainLatency || 0),
      dealLatency: Math.round(provider.averageDealLatency || 0),
      dealSuccessRate: Math.round(provider.dealSuccessRate * 100) / 100,
      dealFailureRate: Math.round((100 - provider.dealSuccessRate) * 100) / 100,
      retrievalSuccessRate: Math.round(provider.retrievalSuccessRate * 100) / 100,
      retrievalFailureRate: Math.round((100 - provider.retrievalSuccessRate) * 100) / 100,
      retrievalLatency: Math.round(provider.averageRetrievalLatency || 0),
      retrievalThroughput: Math.round(provider.averageThroughput || 0),
    }));
  }

  /**
   * Return empty stats structure when no providers exist
   */
  private getEmptyStats(): OverallStatsDto {
    return {
      totalDeals: 0,
      totalRetrievals: 0,
      totalDealsWithCDN: 0,
      totalDealsWithoutCDN: 0,
      totalRetrievalsWithCDN: 0,
      totalRetrievalsWithoutCDN: 0,
      cdnDealsSuccessRate: 0,
      directDealsSuccessRate: 0,
      cdnRetrievalsSuccessRate: 0,
      directRetrievalsSuccessRate: 0,
      ingestLatency: 0,
      chainLatency: 0,
      dealLatency: 0,
      retrievalLatency: 0,
      retrievalThroughput: 0,
      providerPerformance: [],
    };
  }
}
