import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Not, In, Between } from "typeorm";
import { StorageProviderEntity } from "../infrastructure/database/entities/storage-provider.entity.js";
import { DailyMetricsEntity } from "../infrastructure/database/entities/daily-metrics.entity.js";
import {
  OverallStatsDto,
  ProviderPerformanceDto,
  DailyMetricsResponseDto,
  DailyMetricDto,
  ProviderDailyMetricDto,
  FailedDealsResponseDto,
  FailedDealDto,
} from "./stats.dto.js";
import { DealStatus } from "../domain/enums/deal-status.enum.js";
import { DealEntity } from "../infrastructure/database/entities/deal.entity.js";
import { OperationType } from "../infrastructure/database/entities/daily-metrics.entity.js";

@Injectable()
export class StatsService {
  private readonly logger = new Logger(StatsService.name);

  constructor(
    @InjectRepository(StorageProviderEntity)
    private readonly storageProviderRepository: Repository<StorageProviderEntity>,
    @InjectRepository(DailyMetricsEntity)
    private readonly dailyMetricsRepository: Repository<DailyMetricsEntity>,
    @InjectRepository(DealEntity)
    private readonly dealRepository: Repository<DealEntity>,
  ) {}

  /**
   * Get overall statistics aggregated from all storage providers
   */
  async getOverallStats(): Promise<OverallStatsDto> {
    try {
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
        totalIngestThroughput: acc.totalIngestThroughput + (provider.averageIngestThroughput || 0),
        totalRetrievalLatency: acc.totalRetrievalLatency + (provider.averageRetrievalLatency || 0),
        totalRetrievalThroughput: acc.totalRetrievalThroughput + (provider.averageRetrievalThroughput || 0),
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
        totalIngestThroughput: 0,
        totalRetrievalLatency: 0,
        totalRetrievalThroughput: 0,
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
      ingestThroughput:
        totals.providersWithData > 0 ? Math.round(totals.totalIngestThroughput / totals.providersWithData) : 0,
      chainLatency: totals.providersWithData > 0 ? Math.round(totals.totalChainLatency / totals.providersWithData) : 0,
      dealLatency: totals.providersWithData > 0 ? Math.round(totals.totalDealLatency / totals.providersWithData) : 0,
      retrievalLatency:
        totals.providersWithData > 0 ? Math.round(totals.totalRetrievalLatency / totals.providersWithData) : 0,
      retrievalThroughput:
        totals.providersWithRetrievals > 0
          ? Math.round(totals.totalRetrievalThroughput / totals.providersWithRetrievals)
          : 0,
    };
  }

  /**
   * Map provider entities to performance DTOs
   */
  private mapProviderPerformance(providers: StorageProviderEntity[]): ProviderPerformanceDto[] {
    return providers.map((provider) => ({
      provider: provider.address,
      name: provider.name,
      description: provider.description,
      serviceUrl: provider.serviceUrl,
      payee: provider.payee,
      isActive: provider.isActive,
      lastDealTime: provider.lastDealTime,
      totalDeals: provider.totalDeals,
      totalRetrievals: provider.totalRetrievals,
      ingestLatency: Math.round(provider.averageIngestLatency || 0),
      ingestThroughput: Math.round(provider.averageIngestThroughput || 0),
      chainLatency: Math.round(provider.averageChainLatency || 0),
      dealLatency: Math.round(provider.averageDealLatency || 0),
      dealSuccessRate: Math.round(provider.dealSuccessRate * 100) / 100,
      dealFailureRate: Math.round((100 - provider.dealSuccessRate) * 100) / 100,
      retrievalSuccessRate: Math.round(provider.retrievalSuccessRate * 100) / 100,
      retrievalFailureRate: Math.round((100 - provider.retrievalSuccessRate) * 100) / 100,
      retrievalLatency: Math.round(provider.averageRetrievalLatency || 0),
      retrievalThroughput: Math.round(provider.averageRetrievalThroughput || 0),
    }));
  }

  /**
   * Get daily metrics for a specified date range (aggregated with nested provider data)
   */
  async getDailyMetrics(startDate: Date, endDate: Date): Promise<DailyMetricsResponseDto> {
    try {
      const metrics = await this.dailyMetricsRepository.find({
        where: {
          date: Between(startDate, endDate),
        },
        order: {
          date: "ASC",
          storageProvider: "ASC",
        },
      });

      const dailyMetrics = this.aggregateDailyMetricsWithProviders(metrics);
      const summary = this.calculateNestedSummary(dailyMetrics);

      return {
        dailyMetrics,
        dateRange: {
          startDate: startDate.toISOString().split("T")[0],
          endDate: endDate.toISOString().split("T")[0],
        },
        summary,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch daily metrics: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Aggregate daily metrics with nested provider data for recharts visualization
   */
  private aggregateDailyMetricsWithProviders(metrics: DailyMetricsEntity[]): DailyMetricDto[] {
    // First get aggregated daily metrics
    const aggregatedMetrics = this.aggregateDailyMetrics(metrics);

    // Then get provider metrics grouped by date
    const providerMetricsByDate = this.groupProviderMetricsByDate(metrics);

    // Combine them
    return aggregatedMetrics.map((daily) => ({
      ...daily,
      providers: providerMetricsByDate.get(daily.date) || [],
    }));
  }

  /**
   * Group provider metrics by date
   */
  private groupProviderMetricsByDate(metrics: DailyMetricsEntity[]): Map<string, ProviderDailyMetricDto[]> {
    const providerMetrics = this.aggregateProviderDailyMetrics(metrics);
    const groupedByDate = new Map<string, ProviderDailyMetricDto[]>();

    providerMetrics.forEach((metric) => {
      if (!groupedByDate.has(metric.date)) {
        groupedByDate.set(metric.date, []);
      }
      groupedByDate.get(metric.date)!.push(metric);
    });

    return groupedByDate;
  }

  /**
   * Aggregate daily metrics by date for recharts visualization
   */
  private aggregateDailyMetrics(metrics: DailyMetricsEntity[]): DailyMetricDto[] {
    const dailyMap = new Map<string, DailyMetricDto>();

    // Initialize all dates in range with zero values
    const dates = [
      ...new Set(
        metrics.map((m) => {
          const dateStr = m.date instanceof Date ? m.date.toISOString().split("T")[0] : String(m.date);
          return dateStr;
        }),
      ),
    ];
    dates.forEach((date) => {
      dailyMap.set(date, {
        date,
        dealsWithCDN: 0,
        dealsWithoutCDN: 0,
        retrievalsWithCDN: 0,
        retrievalsWithoutCDN: 0,
        dealsSuccessRateWithCDN: 0,
        dealsSuccessRateWithoutCDN: 0,
        retrievalsSuccessRateWithCDN: 0,
        retrievalsSuccessRateWithoutCDN: 0,
        avgDealLatencyWithCDN: 0,
        avgDealLatencyWithoutCDN: 0,
        avgRetrievalLatencyWithCDN: 0,
        avgRetrievalLatencyWithoutCDN: 0,
        avgIngestLatencyWithCDN: 0,
        avgIngestLatencyWithoutCDN: 0,
        avgIngestThroughputWithCDN: 0,
        avgIngestThroughputWithoutCDN: 0,
        avgChainLatencyWithCDN: 0,
        avgChainLatencyWithoutCDN: 0,
        avgRetrievalThroughputWithCDN: 0,
        avgRetrievalThroughputWithoutCDN: 0,
        providers: [], // Initialize empty providers array
      });
    });

    // Aggregate metrics by date, operation type, and CDN usage
    const aggregates = new Map<
      string,
      {
        dealsWithCDN: {
          total: number;
          successful: number;
          dealLatencies: number[];
          ingestLatencies: number[];
          ingestThroughputs: number[];
          chainLatencies: number[];
        };
        dealsWithoutCDN: {
          total: number;
          successful: number;
          dealLatencies: number[];
          ingestLatencies: number[];
          ingestThroughputs: number[];
          chainLatencies: number[];
        };
        retrievalsWithCDN: {
          total: number;
          successful: number;
          retrievalLatencies: number[];
          retrievalThroughputs: number[];
        };
        retrievalsWithoutCDN: {
          total: number;
          successful: number;
          retrievalLatencies: number[];
          retrievalThroughputs: number[];
        };
      }
    >();

    metrics.forEach((metric) => {
      const dateKey = metric.date instanceof Date ? metric.date.toISOString().split("T")[0] : String(metric.date);

      if (!aggregates.has(dateKey)) {
        aggregates.set(dateKey, {
          dealsWithCDN: {
            total: 0,
            successful: 0,
            dealLatencies: [],
            ingestLatencies: [],
            ingestThroughputs: [],
            chainLatencies: [],
          },
          dealsWithoutCDN: {
            total: 0,
            successful: 0,
            dealLatencies: [],
            ingestLatencies: [],
            ingestThroughputs: [],
            chainLatencies: [],
          },
          retrievalsWithCDN: {
            total: 0,
            successful: 0,
            retrievalLatencies: [],
            retrievalThroughputs: [],
          },
          retrievalsWithoutCDN: {
            total: 0,
            successful: 0,
            retrievalLatencies: [],
            retrievalThroughputs: [],
          },
        });
      }

      const dayAgg = aggregates.get(dateKey)!;

      if (metric.operationType === OperationType.DEAL) {
        if (metric.withCDN) {
          dayAgg.dealsWithCDN.total += metric.totalCalls;
          dayAgg.dealsWithCDN.successful += metric.successfulCalls;
          if (metric.avgDealLatency) dayAgg.dealsWithCDN.dealLatencies.push(metric.avgDealLatency);
          if (metric.avgIngestLatency) dayAgg.dealsWithCDN.ingestLatencies.push(metric.avgIngestLatency);
          if (metric.avgIngestThroughput) dayAgg.dealsWithCDN.ingestThroughputs.push(metric.avgIngestThroughput);
          if (metric.avgChainLatency) dayAgg.dealsWithCDN.chainLatencies.push(metric.avgChainLatency);
        } else {
          dayAgg.dealsWithoutCDN.total += metric.totalCalls;
          dayAgg.dealsWithoutCDN.successful += metric.successfulCalls;
          if (metric.avgDealLatency) dayAgg.dealsWithoutCDN.dealLatencies.push(metric.avgDealLatency);
          if (metric.avgIngestLatency) dayAgg.dealsWithoutCDN.ingestLatencies.push(metric.avgIngestLatency);
          if (metric.avgIngestThroughput) dayAgg.dealsWithoutCDN.ingestThroughputs.push(metric.avgIngestThroughput);
          if (metric.avgChainLatency) dayAgg.dealsWithoutCDN.chainLatencies.push(metric.avgChainLatency);
        }
      } else if (metric.operationType === OperationType.RETRIEVAL) {
        if (metric.withCDN) {
          dayAgg.retrievalsWithCDN.total += metric.totalCalls;
          dayAgg.retrievalsWithCDN.successful += metric.successfulCalls;
          if (metric.avgRetrievalLatency) dayAgg.retrievalsWithCDN.retrievalLatencies.push(metric.avgRetrievalLatency);
          if (metric.avgRetrievalThroughput)
            dayAgg.retrievalsWithCDN.retrievalThroughputs.push(metric.avgRetrievalThroughput);
        } else {
          dayAgg.retrievalsWithoutCDN.total += metric.totalCalls;
          dayAgg.retrievalsWithoutCDN.successful += metric.successfulCalls;
          if (metric.avgRetrievalLatency)
            dayAgg.retrievalsWithoutCDN.retrievalLatencies.push(metric.avgRetrievalLatency);
          if (metric.avgRetrievalThroughput)
            dayAgg.retrievalsWithoutCDN.retrievalThroughputs.push(metric.avgRetrievalThroughput);
        }
      }
    });

    // Calculate final metrics for each date
    aggregates.forEach((agg, date) => {
      const daily = dailyMap.get(date)!;

      daily.dealsWithCDN = agg.dealsWithCDN.total;
      daily.dealsWithoutCDN = agg.dealsWithoutCDN.total;
      daily.retrievalsWithCDN = agg.retrievalsWithCDN.total;
      daily.retrievalsWithoutCDN = agg.retrievalsWithoutCDN.total;

      // Calculate success rates
      daily.dealsSuccessRateWithCDN =
        agg.dealsWithCDN.total > 0
          ? Math.round((agg.dealsWithCDN.successful / agg.dealsWithCDN.total) * 100 * 100) / 100
          : 0;
      daily.dealsSuccessRateWithoutCDN =
        agg.dealsWithoutCDN.total > 0
          ? Math.round((agg.dealsWithoutCDN.successful / agg.dealsWithoutCDN.total) * 100 * 100) / 100
          : 0;
      daily.retrievalsSuccessRateWithCDN =
        agg.retrievalsWithCDN.total > 0
          ? Math.round((agg.retrievalsWithCDN.successful / agg.retrievalsWithCDN.total) * 100 * 100) / 100
          : 0;
      daily.retrievalsSuccessRateWithoutCDN =
        agg.retrievalsWithoutCDN.total > 0
          ? Math.round((agg.retrievalsWithoutCDN.successful / agg.retrievalsWithoutCDN.total) * 100 * 100) / 100
          : 0;

      // Calculate average latencies and throughputs
      daily.avgDealLatencyWithCDN =
        agg.dealsWithCDN.dealLatencies.length > 0
          ? Math.round(
              agg.dealsWithCDN.dealLatencies.reduce((a, b) => a + b, 0) / agg.dealsWithCDN.dealLatencies.length,
            )
          : 0;
      daily.avgDealLatencyWithoutCDN =
        agg.dealsWithoutCDN.dealLatencies.length > 0
          ? Math.round(
              agg.dealsWithoutCDN.dealLatencies.reduce((a, b) => a + b, 0) / agg.dealsWithoutCDN.dealLatencies.length,
            )
          : 0;
      daily.avgRetrievalLatencyWithCDN =
        agg.retrievalsWithCDN.retrievalLatencies.length > 0
          ? Math.round(
              agg.retrievalsWithCDN.retrievalLatencies.reduce((a, b) => a + b, 0) /
                agg.retrievalsWithCDN.retrievalLatencies.length,
            )
          : 0;
      daily.avgRetrievalLatencyWithoutCDN =
        agg.retrievalsWithoutCDN.retrievalLatencies.length > 0
          ? Math.round(
              agg.retrievalsWithoutCDN.retrievalLatencies.reduce((a, b) => a + b, 0) /
                agg.retrievalsWithoutCDN.retrievalLatencies.length,
            )
          : 0;

      // Calculate ingest metrics
      daily.avgIngestLatencyWithCDN =
        agg.dealsWithCDN.ingestLatencies.length > 0
          ? Math.round(
              agg.dealsWithCDN.ingestLatencies.reduce((a, b) => a + b, 0) / agg.dealsWithCDN.ingestLatencies.length,
            )
          : 0;
      daily.avgIngestLatencyWithoutCDN =
        agg.dealsWithoutCDN.ingestLatencies.length > 0
          ? Math.round(
              agg.dealsWithoutCDN.ingestLatencies.reduce((a, b) => a + b, 0) /
                agg.dealsWithoutCDN.ingestLatencies.length,
            )
          : 0;
      daily.avgIngestThroughputWithCDN =
        agg.dealsWithCDN.ingestThroughputs.length > 0
          ? Math.round(
              agg.dealsWithCDN.ingestThroughputs.reduce((a, b) => a + b, 0) / agg.dealsWithCDN.ingestThroughputs.length,
            )
          : 0;
      daily.avgIngestThroughputWithoutCDN =
        agg.dealsWithoutCDN.ingestThroughputs.length > 0
          ? Math.round(
              agg.dealsWithoutCDN.ingestThroughputs.reduce((a, b) => a + b, 0) /
                agg.dealsWithoutCDN.ingestThroughputs.length,
            )
          : 0;

      // Calculate chain latency metrics
      daily.avgChainLatencyWithCDN =
        agg.dealsWithCDN.chainLatencies.length > 0
          ? Math.round(
              agg.dealsWithCDN.chainLatencies.reduce((a, b) => a + b, 0) / agg.dealsWithCDN.chainLatencies.length,
            )
          : 0;
      daily.avgChainLatencyWithoutCDN =
        agg.dealsWithoutCDN.chainLatencies.length > 0
          ? Math.round(
              agg.dealsWithoutCDN.chainLatencies.reduce((a, b) => a + b, 0) / agg.dealsWithoutCDN.chainLatencies.length,
            )
          : 0;

      // Calculate retrieval throughput metrics
      daily.avgRetrievalThroughputWithCDN =
        agg.retrievalsWithCDN.retrievalThroughputs.length > 0
          ? Math.round(
              agg.retrievalsWithCDN.retrievalThroughputs.reduce((a, b) => a + b, 0) /
                agg.retrievalsWithCDN.retrievalThroughputs.length,
            )
          : 0;
      daily.avgRetrievalThroughputWithoutCDN =
        agg.retrievalsWithoutCDN.retrievalThroughputs.length > 0
          ? Math.round(
              agg.retrievalsWithoutCDN.retrievalThroughputs.reduce((a, b) => a + b, 0) /
                agg.retrievalsWithoutCDN.retrievalThroughputs.length,
            )
          : 0;
    });

    return Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Aggregate per-provider daily metrics by date and provider
   */
  private aggregateProviderDailyMetrics(metrics: DailyMetricsEntity[]): ProviderDailyMetricDto[] {
    const providerDailyMap = new Map<string, ProviderDailyMetricDto>();

    // Initialize all date-provider combinations with zero values
    const dateProviderKeys = [
      ...new Set(
        metrics.map((m) => {
          const dateStr = m.date instanceof Date ? m.date.toISOString().split("T")[0] : String(m.date);
          return `${dateStr}_${m.storageProvider}`;
        }),
      ),
    ];
    dateProviderKeys.forEach((key) => {
      const [date, provider] = key.split("_");
      providerDailyMap.set(key, {
        date,
        provider,
        dealsWithCDN: 0,
        dealsWithoutCDN: 0,
        retrievalsWithoutCDN: 0,
        dealsSuccessRateWithCDN: 0,
        dealsSuccessRateWithoutCDN: 0,
        retrievalsSuccessRateWithoutCDN: 0,
        avgDealLatencyWithCDN: 0,
        avgDealLatencyWithoutCDN: 0,
        avgRetrievalLatencyWithoutCDN: 0,
        avgIngestLatencyWithCDN: 0,
        avgIngestLatencyWithoutCDN: 0,
        avgIngestThroughputWithCDN: 0,
        avgIngestThroughputWithoutCDN: 0,
        avgChainLatencyWithCDN: 0,
        avgChainLatencyWithoutCDN: 0,
        avgRetrievalThroughputWithoutCDN: 0,
      });
    });

    // Aggregate metrics by date-provider, operation type, and CDN usage
    const providerAggregates = new Map<
      string,
      {
        dealsWithCDN: {
          total: number;
          successful: number;
          dealLatencies: number[];
          ingestLatencies: number[];
          ingestThroughputs: number[];
          chainLatencies: number[];
        };
        dealsWithoutCDN: {
          total: number;
          successful: number;
          dealLatencies: number[];
          ingestLatencies: number[];
          ingestThroughputs: number[];
          chainLatencies: number[];
        };
        retrievalsWithoutCDN: {
          total: number;
          successful: number;
          retrievalLatencies: number[];
          retrievalThroughputs: number[];
        };
      }
    >();

    metrics.forEach((metric) => {
      const dateStr = metric.date instanceof Date ? metric.date.toISOString().split("T")[0] : String(metric.date);
      const dateProviderKey = `${dateStr}_${metric.storageProvider}`;

      if (!providerAggregates.has(dateProviderKey)) {
        providerAggregates.set(dateProviderKey, {
          dealsWithCDN: {
            total: 0,
            successful: 0,
            dealLatencies: [],
            ingestLatencies: [],
            ingestThroughputs: [],
            chainLatencies: [],
          },
          dealsWithoutCDN: {
            total: 0,
            successful: 0,
            dealLatencies: [],
            ingestLatencies: [],
            ingestThroughputs: [],
            chainLatencies: [],
          },
          retrievalsWithoutCDN: {
            total: 0,
            successful: 0,
            retrievalLatencies: [],
            retrievalThroughputs: [],
          },
        });
      }

      const providerAgg = providerAggregates.get(dateProviderKey)!;

      if (metric.operationType === OperationType.DEAL) {
        if (metric.withCDN) {
          providerAgg.dealsWithCDN.total += metric.totalCalls;
          providerAgg.dealsWithCDN.successful += metric.successfulCalls;
          if (metric.avgDealLatency) providerAgg.dealsWithCDN.dealLatencies.push(metric.avgDealLatency);
          if (metric.avgIngestLatency) providerAgg.dealsWithCDN.ingestLatencies.push(metric.avgIngestLatency);
          if (metric.avgIngestThroughput) providerAgg.dealsWithCDN.ingestThroughputs.push(metric.avgIngestThroughput);
          if (metric.avgChainLatency) providerAgg.dealsWithCDN.chainLatencies.push(metric.avgChainLatency);
        } else {
          providerAgg.dealsWithoutCDN.total += metric.totalCalls;
          providerAgg.dealsWithoutCDN.successful += metric.successfulCalls;
          if (metric.avgDealLatency) providerAgg.dealsWithoutCDN.dealLatencies.push(metric.avgDealLatency);
          if (metric.avgIngestLatency) providerAgg.dealsWithoutCDN.ingestLatencies.push(metric.avgIngestLatency);
          if (metric.avgIngestThroughput)
            providerAgg.dealsWithoutCDN.ingestThroughputs.push(metric.avgIngestThroughput);
          if (metric.avgChainLatency) providerAgg.dealsWithoutCDN.chainLatencies.push(metric.avgChainLatency);
        }
      } else if (metric.operationType === OperationType.RETRIEVAL && !metric.withCDN) {
        // Only track retrievals without CDN for per-provider metrics
        providerAgg.retrievalsWithoutCDN.total += metric.totalCalls;
        providerAgg.retrievalsWithoutCDN.successful += metric.successfulCalls;
        if (metric.avgRetrievalLatency)
          providerAgg.retrievalsWithoutCDN.retrievalLatencies.push(metric.avgRetrievalLatency);
        if (metric.avgRetrievalThroughput)
          providerAgg.retrievalsWithoutCDN.retrievalThroughputs.push(metric.avgRetrievalThroughput);
      }
    });

    // Calculate final metrics for each date-provider combination
    providerAggregates.forEach((agg, dateProviderKey) => {
      const providerDaily = providerDailyMap.get(dateProviderKey)!;

      providerDaily.dealsWithCDN = agg.dealsWithCDN.total;
      providerDaily.dealsWithoutCDN = agg.dealsWithoutCDN.total;
      providerDaily.retrievalsWithoutCDN = agg.retrievalsWithoutCDN.total;

      // Calculate success rates
      providerDaily.dealsSuccessRateWithCDN =
        agg.dealsWithCDN.total > 0
          ? Math.round((agg.dealsWithCDN.successful / agg.dealsWithCDN.total) * 100 * 100) / 100
          : 0;
      providerDaily.dealsSuccessRateWithoutCDN =
        agg.dealsWithoutCDN.total > 0
          ? Math.round((agg.dealsWithoutCDN.successful / agg.dealsWithoutCDN.total) * 100 * 100) / 100
          : 0;
      providerDaily.retrievalsSuccessRateWithoutCDN =
        agg.retrievalsWithoutCDN.total > 0
          ? Math.round((agg.retrievalsWithoutCDN.successful / agg.retrievalsWithoutCDN.total) * 100 * 100) / 100
          : 0;

      // Calculate average latencies and throughputs
      providerDaily.avgDealLatencyWithCDN =
        agg.dealsWithCDN.dealLatencies.length > 0
          ? Math.round(
              agg.dealsWithCDN.dealLatencies.reduce((a, b) => a + b, 0) / agg.dealsWithCDN.dealLatencies.length,
            )
          : 0;
      providerDaily.avgDealLatencyWithoutCDN =
        agg.dealsWithoutCDN.dealLatencies.length > 0
          ? Math.round(
              agg.dealsWithoutCDN.dealLatencies.reduce((a, b) => a + b, 0) / agg.dealsWithoutCDN.dealLatencies.length,
            )
          : 0;
      providerDaily.avgRetrievalLatencyWithoutCDN =
        agg.retrievalsWithoutCDN.retrievalLatencies.length > 0
          ? Math.round(
              agg.retrievalsWithoutCDN.retrievalLatencies.reduce((a, b) => a + b, 0) /
                agg.retrievalsWithoutCDN.retrievalLatencies.length,
            )
          : 0;

      // Calculate ingest metrics
      providerDaily.avgIngestLatencyWithCDN =
        agg.dealsWithCDN.ingestLatencies.length > 0
          ? Math.round(
              agg.dealsWithCDN.ingestLatencies.reduce((a, b) => a + b, 0) / agg.dealsWithCDN.ingestLatencies.length,
            )
          : 0;
      providerDaily.avgIngestLatencyWithoutCDN =
        agg.dealsWithoutCDN.ingestLatencies.length > 0
          ? Math.round(
              agg.dealsWithoutCDN.ingestLatencies.reduce((a, b) => a + b, 0) /
                agg.dealsWithoutCDN.ingestLatencies.length,
            )
          : 0;
      providerDaily.avgIngestThroughputWithCDN =
        agg.dealsWithCDN.ingestThroughputs.length > 0
          ? Math.round(
              agg.dealsWithCDN.ingestThroughputs.reduce((a, b) => a + b, 0) / agg.dealsWithCDN.ingestThroughputs.length,
            )
          : 0;
      providerDaily.avgIngestThroughputWithoutCDN =
        agg.dealsWithoutCDN.ingestThroughputs.length > 0
          ? Math.round(
              agg.dealsWithoutCDN.ingestThroughputs.reduce((a, b) => a + b, 0) /
                agg.dealsWithoutCDN.ingestThroughputs.length,
            )
          : 0;

      // Calculate chain latency metrics
      providerDaily.avgChainLatencyWithCDN =
        agg.dealsWithCDN.chainLatencies.length > 0
          ? Math.round(
              agg.dealsWithCDN.chainLatencies.reduce((a, b) => a + b, 0) / agg.dealsWithCDN.chainLatencies.length,
            )
          : 0;
      providerDaily.avgChainLatencyWithoutCDN =
        agg.dealsWithoutCDN.chainLatencies.length > 0
          ? Math.round(
              agg.dealsWithoutCDN.chainLatencies.reduce((a, b) => a + b, 0) / agg.dealsWithoutCDN.chainLatencies.length,
            )
          : 0;

      // Calculate retrieval throughput metrics
      providerDaily.avgRetrievalThroughputWithoutCDN =
        agg.retrievalsWithoutCDN.retrievalThroughputs.length > 0
          ? Math.round(
              agg.retrievalsWithoutCDN.retrievalThroughputs.reduce((a, b) => a + b, 0) /
                agg.retrievalsWithoutCDN.retrievalThroughputs.length,
            )
          : 0;
    });

    return Array.from(providerDailyMap.values()).sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      return dateCompare !== 0 ? dateCompare : a.provider.localeCompare(b.provider);
    });
  }

  /**
   * Calculate summary statistics for nested daily metrics structure
   */
  private calculateNestedSummary(dailyMetrics: DailyMetricDto[]) {
    const totalDeals = dailyMetrics.reduce((sum, day) => sum + day.dealsWithCDN + day.dealsWithoutCDN, 0);
    const totalRetrievals = dailyMetrics.reduce(
      (sum, day) => sum + day.retrievalsWithCDN + day.retrievalsWithoutCDN,
      0,
    );

    // Get unique providers from all nested provider arrays
    const allProviders = new Set<string>();
    dailyMetrics.forEach((day) => {
      day.providers.forEach((provider) => {
        allProviders.add(provider.provider);
      });
    });

    return {
      totalDays: dailyMetrics.length,
      totalProviders: allProviders.size,
      totalDeals,
      totalRetrievals,
    };
  }

  /**
   * Get failed deals for a specified date range with error details
   */
  async getFailedDeals(startDate: Date, endDate: Date, limit: number = 100): Promise<FailedDealsResponseDto> {
    try {
      // Get failed deals (deals that are not successful with error messages)
      const failedDeals = await this.dealRepository.find({
        where: {
          createdAt: Between(startDate, endDate),
          status: In([DealStatus.FAILED]),
          errorMessage: Not(""),
        },
        order: {
          createdAt: "DESC",
        },
        take: limit,
      });

      // Map to DTOs
      const failedDealDtos: FailedDealDto[] = failedDeals.map((deal) => ({
        id: deal.id,
        fileName: deal.fileName,
        fileSize: Number(deal.fileSize),
        dataSetId: deal.dataSetId,
        cid: deal.cid || "",
        dealId: deal.dealId || "",
        storageProvider: deal.storageProvider,
        withCDN: deal.withCDN,
        status: deal.status,
        errorMessage: deal.errorMessage || "",
        errorCode: deal.errorCode || "",
        retryCount: deal.retryCount,
        createdAt: deal.createdAt,
        updatedAt: deal.updatedAt,
        uploadStartTime: deal.uploadStartTime,
        uploadEndTime: deal.uploadEndTime,
        pieceAddedTime: deal.pieceAddedTime,
        dealConfirmedTime: deal.dealConfirmedTime,
      }));

      // Calculate summary statistics
      const summary = this.calculateFailedDealsSummary(failedDealDtos);

      return {
        failedDeals: failedDealDtos,
        summary,
        dateRange: {
          startDate: startDate.toISOString().split("T")[0],
          endDate: endDate.toISOString().split("T")[0],
        },
      };
    } catch (error) {
      this.logger.error(`Failed to fetch failed deals: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Calculate summary statistics for failed deals
   */
  private calculateFailedDealsSummary(failedDeals: FailedDealDto[]) {
    const totalFailedDeals = failedDeals.length;
    const uniqueProviders = new Set(failedDeals.map((deal) => deal.storageProvider)).size;

    // Count errors by type
    const errorCounts = new Map<string, { errorMessage: string; count: number }>();
    failedDeals.forEach((deal) => {
      const key = `${deal.errorCode}:${deal.errorMessage}`;
      if (errorCounts.has(key)) {
        errorCounts.get(key)!.count++;
      } else {
        errorCounts.set(key, {
          errorMessage: deal.errorMessage,
          count: 1,
        });
      }
    });

    // Get most common errors
    const mostCommonErrors = Array.from(errorCounts.entries())
      .map(([key, value]) => ({
        errorCode: key.split(":")[0],
        errorMessage: value.errorMessage,
        count: value.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Count failures by provider
    const providerFailures = new Map<string, { count: number; errors: string[] }>();
    failedDeals.forEach((deal) => {
      if (providerFailures.has(deal.storageProvider)) {
        const existing = providerFailures.get(deal.storageProvider)!;
        existing.count++;
        existing.errors.push(deal.errorMessage);
      } else {
        providerFailures.set(deal.storageProvider, {
          count: 1,
          errors: [deal.errorMessage],
        });
      }
    });

    // Get failures by provider with most common error for each
    const failuresByProvider = Array.from(providerFailures.entries())
      .map(([provider, data]) => {
        // Find most common error for this provider
        const errorCounts = new Map<string, number>();
        data.errors.forEach((error) => {
          errorCounts.set(error, (errorCounts.get(error) || 0) + 1);
        });
        const mostCommonError =
          Array.from(errorCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "Unknown error";

        return {
          provider,
          failedDeals: data.count,
          mostCommonError,
        };
      })
      .sort((a, b) => b.failedDeals - a.failedDeals);

    return {
      totalFailedDeals,
      uniqueProviders,
      mostCommonErrors,
      failuresByProvider,
    };
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
      ingestThroughput: 0,
      chainLatency: 0,
      dealLatency: 0,
      retrievalLatency: 0,
      retrievalThroughput: 0,
      providerPerformance: [],
    };
  }
}
