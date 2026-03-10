import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Between, type Repository } from "typeorm";
import { toStructuredError } from "../../common/logging.js";
import { MetricsDaily } from "../../database/entities/metrics-daily.entity.js";
import { MetricType, ServiceType } from "../../database/types.js";
import type {
  DailyAggregatedMetricsDto,
  DailyMetricsResponseDto,
  ProviderDailyMetricsDto,
  ProviderDailyMetricsResponseDto,
  ServiceComparisonMetricsDto,
  ServiceComparisonResponseDto,
  ServiceMetrics,
} from "../dto/daily-metrics.dto.js";

/**
 * Service for handling daily metrics queries
 * Provides time-series data for visualization and analysis
 *
 * Uses metrics_daily table which aggregates by:
 * - dailyBucket (date)
 * - spAddress (provider)
 * - serviceType (DIRECT_SP, IPFS_PIN)
 *
 * @class DailyMetricsService
 */
@Injectable()
export class DailyMetricsService {
  private readonly logger = new Logger(DailyMetricsService.name);

  constructor(
    @InjectRepository(MetricsDaily)
    private readonly metricsDailyRepo: Repository<MetricsDaily>,
  ) {}

  /**
   * Get aggregated daily metrics for a date range
   * Groups metrics by date across all providers
   *
   * @param startDate - Start date for the query
   * @param endDate - End date for the query
   * @returns Aggregated daily metrics with summary
   */
  async getDailyMetrics(startDate: Date, endDate: Date): Promise<DailyMetricsResponseDto> {
    try {
      this.validateDateRange(startDate, endDate, 90);

      // Query metrics_daily table
      const metrics = await this.metricsDailyRepo.find({
        where: {
          dailyBucket: Between(startDate, endDate),
        },
        order: {
          dailyBucket: "ASC",
        },
      });

      if (metrics.length === 0) {
        return this.getEmptyDailyMetricsResponse(startDate, endDate);
      }

      // Group by date and aggregate
      const dailyMetrics = this.aggregateByDate(metrics);
      const summary = this.calculateSummary(dailyMetrics, metrics);

      return {
        dailyMetrics,
        dateRange: {
          startDate: startDate.toISOString().split("T")[0],
          endDate: endDate.toISOString().split("T")[0],
        },
        summary,
      };
    } catch (error) {
      this.logger.error({
        event: "fetch_daily_metrics_failed",
        message: "Failed to fetch daily metrics",
        error: toStructuredError(error),
      });
      throw error;
    }
  }

  /**
   * Get daily metrics for a specific provider
   *
   * @param spAddress - Storage provider address
   * @param startDate - Start date for the query
   * @param endDate - End date for the query
   * @returns Provider-specific daily metrics
   */
  async getProviderDailyMetrics(
    spAddress: string,
    startDate: Date,
    endDate: Date,
  ): Promise<ProviderDailyMetricsResponseDto> {
    try {
      this.validateDateRange(startDate, endDate, 90);

      const metrics = await this.metricsDailyRepo.find({
        where: {
          spAddress,
          dailyBucket: Between(startDate, endDate),
        },
        order: {
          dailyBucket: "ASC",
        },
      });

      if (metrics.length === 0) {
        return this.getEmptyProviderDailyMetricsResponse(spAddress, startDate, endDate);
      }

      const dailyMetrics = this.mapToProviderDailyMetrics(metrics);
      const summary = this.calculateProviderSummary(dailyMetrics);

      return {
        spAddress,
        dailyMetrics,
        dateRange: {
          startDate: startDate.toISOString().split("T")[0],
          endDate: endDate.toISOString().split("T")[0],
        },
        summary,
      };
    } catch (error) {
      this.logger.error({
        event: "fetch_provider_daily_metrics_failed",
        message: `Failed to fetch provider daily metrics for ${spAddress}`,
        spAddress,
        error: toStructuredError(error),
      });
      throw error;
    }
  }

  /**
   * Get recent daily metrics (last N days)
   *
   * @param days - Number of days to fetch (default: 30)
   * @returns Recent daily metrics
   */
  async getRecentDailyMetrics(days: number = 30): Promise<DailyMetricsResponseDto> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return this.getDailyMetrics(startDate, endDate);
  }

  /**
   * Get service type comparison metrics for a date range
   * Breaks down retrieval metrics by service type (DIRECT_SP, IPFS_PIN)
   *
   * @param startDate - Start date for the query
   * @param endDate - End date for the query
   * @returns Service comparison metrics with daily breakdown
   */
  async getServiceComparison(startDate: Date, endDate: Date): Promise<ServiceComparisonResponseDto> {
    try {
      this.validateDateRange(startDate, endDate, 90);

      // Query metrics_daily table - only retrieval metrics (service_type NOT NULL)
      const metrics = await this.metricsDailyRepo.find({
        where: {
          dailyBucket: Between(startDate, endDate),
        },
        order: {
          dailyBucket: "ASC",
        },
      });

      if (metrics.length === 0) {
        return this.getEmptyServiceComparisonResponse(startDate, endDate);
      }

      const retrievalMetrics = metrics.filter(
        (m): m is MetricsDaily & { serviceType: ServiceType } => m.serviceType !== null,
      );
      const supportedServiceTypes = new Set<ServiceType>([ServiceType.DIRECT_SP, ServiceType.IPFS_PIN]);
      const unsupportedServiceTypes = new Set(
        retrievalMetrics.map((m) => m.serviceType).filter((serviceType) => !supportedServiceTypes.has(serviceType)),
      );

      if (unsupportedServiceTypes.size > 0) {
        this.logger.warn(
          `Service comparison excludes unsupported service types: ${[...unsupportedServiceTypes].join(", ")}`,
        );
      }

      // ServiceComparisonMetricsDto only exposes the supported service types.
      const supportedRetrievalMetrics = retrievalMetrics.filter((m) => supportedServiceTypes.has(m.serviceType));

      // Group by date and aggregate by service type
      const dailyMetrics = this.aggregateByServiceType(supportedRetrievalMetrics);
      const summary = this.calculateServiceSummary(dailyMetrics);

      return {
        dailyMetrics,
        dateRange: {
          startDate: startDate.toISOString().split("T")[0],
          endDate: endDate.toISOString().split("T")[0],
        },
        summary,
      };
    } catch (error) {
      this.logger.error({
        event: "fetch_service_comparison_failed",
        message: "Failed to fetch service comparison",
        error: toStructuredError(error),
      });
      throw error;
    }
  }

  /**
   * Aggregate metrics by date
   * Groups by dailyBucket and aggregates across all providers and service types
   *
   * @private
   */
  private aggregateByDate(metrics: MetricsDaily[]): DailyAggregatedMetricsDto[] {
    const dateMap = new Map<
      string,
      {
        totalDeals: number;
        successfulDeals: number;
        totalRetrievals: number;
        successfulRetrievals: number;
        dealLatencySum: number;
        dealLatencyCount: number;
        ingestLatencySum: number;
        ingestLatencyCount: number;
        retrievalLatencySum: number;
        retrievalLatencyCount: number;
        retrievalTtfbSum: number;
        retrievalTtfbCount: number;
        ingestThroughputSum: number;
        ingestThroughputCount: number;
        retrievalThroughputSum: number;
        retrievalThroughputCount: number;
        totalDataStoredBytes: bigint;
        totalDataRetrievedBytes: bigint;
        uniqueProviders: Set<string>;
      }
    >();

    for (const metric of metrics) {
      const dateKey = metric.dailyBucket.toISOString().split("T")[0];

      let agg = dateMap.get(dateKey);
      if (!agg) {
        agg = {
          totalDeals: 0,
          successfulDeals: 0,
          totalRetrievals: 0,
          successfulRetrievals: 0,
          dealLatencySum: 0,
          dealLatencyCount: 0,
          ingestLatencySum: 0,
          ingestLatencyCount: 0,
          retrievalLatencySum: 0,
          retrievalLatencyCount: 0,
          retrievalTtfbSum: 0,
          retrievalTtfbCount: 0,
          ingestThroughputSum: 0,
          ingestThroughputCount: 0,
          retrievalThroughputSum: 0,
          retrievalThroughputCount: 0,
          totalDataStoredBytes: BigInt(0),
          totalDataRetrievedBytes: BigInt(0),
          uniqueProviders: new Set<string>(),
        };
        dateMap.set(dateKey, agg);
      }

      const isMetricTypeDeal = metric.metricType === MetricType.DEAL;

      // Aggregate deals
      if (isMetricTypeDeal) {
        agg.totalDeals += metric.totalDeals || 0;
        agg.successfulDeals += metric.successfulDeals || 0;
        agg.totalDataStoredBytes += BigInt(metric.totalDataStoredBytes || 0);
        agg.uniqueProviders.add(metric.spAddress);

        if (metric.avgDealLatencyMs) {
          agg.dealLatencySum += metric.avgDealLatencyMs;
          agg.dealLatencyCount++;
        }

        if (metric.avgIngestLatencyMs) {
          agg.ingestLatencySum += metric.avgIngestLatencyMs;
          agg.ingestLatencyCount++;
        }

        if (metric.avgIngestThroughputBps) {
          agg.ingestThroughputSum += metric.avgIngestThroughputBps;
          agg.ingestThroughputCount++;
        }
      }

      // Aggregate retrievals (for all service types)
      if (metric.metricType === MetricType.RETRIEVAL) {
        agg.totalRetrievals += metric.totalRetrievals || 0;
        agg.successfulRetrievals += metric.successfulRetrievals || 0;
        agg.totalDataRetrievedBytes += BigInt(metric.totalDataRetrievedBytes || 0);

        if (metric.avgRetrievalLatencyMs) {
          agg.retrievalLatencySum += metric.avgRetrievalLatencyMs;
          agg.retrievalLatencyCount++;
        }

        if (metric.avgRetrievalTtfbMs) {
          agg.retrievalTtfbSum += metric.avgRetrievalTtfbMs;
          agg.retrievalTtfbCount++;
        }

        if (metric.avgRetrievalThroughputBps) {
          agg.retrievalThroughputSum += metric.avgRetrievalThroughputBps;
          agg.retrievalThroughputCount++;
        }
      }
    }

    // Build result array
    const aggregated: DailyAggregatedMetricsDto[] = [];

    for (const [date, agg] of dateMap) {
      aggregated.push({
        date,
        totalDeals: agg.totalDeals,
        successfulDeals: agg.successfulDeals,
        dealSuccessRate: agg.totalDeals > 0 ? Math.round((agg.successfulDeals / agg.totalDeals) * 10000) / 100 : 0,
        totalRetrievals: agg.totalRetrievals,
        successfulRetrievals: agg.successfulRetrievals,
        retrievalSuccessRate:
          agg.totalRetrievals > 0 ? Math.round((agg.successfulRetrievals / agg.totalRetrievals) * 10000) / 100 : 0,
        avgDealLatencyMs: agg.dealLatencyCount > 0 ? Math.round(agg.dealLatencySum / agg.dealLatencyCount) : 0,
        avgRetrievalLatencyMs:
          agg.retrievalLatencyCount > 0 ? Math.round(agg.retrievalLatencySum / agg.retrievalLatencyCount) : 0,
        avgRetrievalTtfbMs: agg.retrievalTtfbCount > 0 ? Math.round(agg.retrievalTtfbSum / agg.retrievalTtfbCount) : 0,
        totalDataStoredBytes: agg.totalDataStoredBytes.toString(),
        totalDataRetrievedBytes: agg.totalDataRetrievedBytes.toString(),
        uniqueProviders: agg.uniqueProviders.size,
        avgIngestLatencyMs: agg.ingestLatencyCount > 0 ? Math.round(agg.ingestLatencySum / agg.ingestLatencyCount) : 0,
        avgIngestThroughputBps:
          agg.ingestThroughputCount > 0 ? Math.round(agg.ingestThroughputSum / agg.ingestThroughputCount) : 0,
        avgRetrievalThroughputBps:
          agg.retrievalThroughputCount > 0 ? Math.round(agg.retrievalThroughputSum / agg.retrievalThroughputCount) : 0,
      });
    }

    return aggregated.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Map metrics to provider daily metrics DTOs
   * Aggregates across service types for each provider-date combination
   *
   * @private
   */
  private mapToProviderDailyMetrics(metrics: MetricsDaily[]): ProviderDailyMetricsDto[] {
    const dateMap = new Map<
      string,
      {
        spAddress: string;
        totalDeals: number;
        successfulDeals: number;
        totalRetrievals: number;
        successfulRetrievals: number;
        dealLatencySum: number;
        dealLatencyCount: number;
        ingestLatencySum: number;
        ingestLatencyCount: number;
        retrievalLatencySum: number;
        retrievalLatencyCount: number;
        retrievalTtfbSum: number;
        retrievalTtfbCount: number;
        retrievalThroughputSum: number;
        retrievalThroughputCount: number;
        ingestThroughputSum: number;
        ingestThroughputCount: number;
      }
    >();

    for (const metric of metrics) {
      const dateKey = metric.dailyBucket.toISOString().split("T")[0];

      let agg = dateMap.get(dateKey);
      if (!agg) {
        agg = {
          spAddress: metric.spAddress,
          totalDeals: 0,
          successfulDeals: 0,
          totalRetrievals: 0,
          successfulRetrievals: 0,
          dealLatencySum: 0,
          dealLatencyCount: 0,
          ingestLatencySum: 0,
          ingestLatencyCount: 0,
          retrievalLatencySum: 0,
          retrievalLatencyCount: 0,
          retrievalTtfbSum: 0,
          retrievalTtfbCount: 0,
          retrievalThroughputSum: 0,
          retrievalThroughputCount: 0,
          ingestThroughputSum: 0,
          ingestThroughputCount: 0,
        };
        dateMap.set(dateKey, agg);
      }

      const isMetricTypeDeal = metric.metricType === MetricType.DEAL;

      if (isMetricTypeDeal) {
        // Deal metrics
        agg.totalDeals += metric.totalDeals || 0;
        agg.successfulDeals += metric.successfulDeals || 0;

        if (metric.avgDealLatencyMs) {
          agg.dealLatencySum += metric.avgDealLatencyMs;
          agg.dealLatencyCount++;
        }

        if (metric.avgIngestLatencyMs) {
          agg.ingestLatencySum += metric.avgIngestLatencyMs;
          agg.ingestLatencyCount++;
        }

        if (metric.avgIngestThroughputBps) {
          agg.ingestThroughputSum += metric.avgIngestThroughputBps;
          agg.ingestThroughputCount++;
        }
      } else {
        // Retrieval metrics
        agg.totalRetrievals += metric.totalRetrievals || 0;
        agg.successfulRetrievals += metric.successfulRetrievals || 0;

        if (metric.avgRetrievalLatencyMs) {
          agg.retrievalLatencySum += metric.avgRetrievalLatencyMs;
          agg.retrievalLatencyCount++;
        }

        if (metric.avgRetrievalThroughputBps) {
          agg.retrievalThroughputSum += metric.avgRetrievalThroughputBps;
          agg.retrievalThroughputCount++;
        }

        if (metric.avgRetrievalTtfbMs) {
          agg.retrievalTtfbSum += metric.avgRetrievalTtfbMs;
          agg.retrievalTtfbCount++;
        }
      }
    }

    const result: ProviderDailyMetricsDto[] = [];

    for (const [date, agg] of dateMap) {
      result.push({
        date,
        spAddress: agg.spAddress,
        totalDeals: agg.totalDeals,
        successfulDeals: agg.successfulDeals,
        dealSuccessRate: agg.totalDeals > 0 ? Math.round((agg.successfulDeals / agg.totalDeals) * 10000) / 100 : 0,
        totalRetrievals: agg.totalRetrievals,
        successfulRetrievals: agg.successfulRetrievals,
        retrievalSuccessRate:
          agg.totalRetrievals > 0 ? Math.round((agg.successfulRetrievals / agg.totalRetrievals) * 10000) / 100 : 0,
        avgDealLatencyMs: agg.dealLatencyCount > 0 ? Math.round(agg.dealLatencySum / agg.dealLatencyCount) : 0,
        avgIngestLatencyMs: agg.ingestLatencyCount > 0 ? Math.round(agg.ingestLatencySum / agg.ingestLatencyCount) : 0,
        avgRetrievalLatencyMs:
          agg.retrievalLatencyCount > 0 ? Math.round(agg.retrievalLatencySum / agg.retrievalLatencyCount) : 0,
        avgRetrievalThroughputBps:
          agg.retrievalThroughputCount > 0 ? Math.round(agg.retrievalThroughputSum / agg.retrievalThroughputCount) : 0,
        avgRetrievalTtfbMs: agg.retrievalTtfbCount > 0 ? Math.round(agg.retrievalTtfbSum / agg.retrievalTtfbCount) : 0,
        avgIngestThroughputBps:
          agg.ingestThroughputCount > 0 ? Math.round(agg.ingestThroughputSum / agg.ingestThroughputCount) : 0,
      });
    }

    return result.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Calculate summary statistics
   *
   * @private
   */
  private calculateSummary(dailyMetrics: DailyAggregatedMetricsDto[], rawMetrics: MetricsDaily[]) {
    let totalDeals = 0;
    let totalRetrievals = 0;
    let successfulDeals = 0;
    let successfulRetrievals = 0;

    for (const day of dailyMetrics) {
      totalDeals += day.totalDeals;
      totalRetrievals += day.totalRetrievals;
      successfulDeals += day.successfulDeals;
      successfulRetrievals += day.successfulRetrievals;
    }

    const uniqueProviders = new Set<string>();
    for (const m of rawMetrics) {
      if (m.metricType === MetricType.DEAL) {
        uniqueProviders.add(m.spAddress);
      }
    }

    return {
      totalDays: dailyMetrics.length,
      totalProviders: uniqueProviders.size,
      totalDeals,
      totalRetrievals,
      avgDealSuccessRate: totalDeals > 0 ? Math.round((successfulDeals / totalDeals) * 10000) / 100 : 0,
      avgRetrievalSuccessRate:
        totalRetrievals > 0 ? Math.round((successfulRetrievals / totalRetrievals) * 10000) / 100 : 0,
    };
  }

  /**
   * Calculate provider-specific summary
   *
   * @private
   */
  private calculateProviderSummary(dailyMetrics: ProviderDailyMetricsDto[]) {
    let totalDeals = 0;
    let totalRetrievals = 0;
    let successfulDeals = 0;
    let successfulRetrievals = 0;

    for (const day of dailyMetrics) {
      totalDeals += day.totalDeals;
      totalRetrievals += day.totalRetrievals;
      successfulDeals += day.successfulDeals;
      successfulRetrievals += day.successfulRetrievals;
    }

    return {
      totalDays: dailyMetrics.length,
      totalDeals,
      totalRetrievals,
      avgDealSuccessRate: totalDeals > 0 ? Math.round((successfulDeals / totalDeals) * 10000) / 100 : 0,
      avgRetrievalSuccessRate:
        totalRetrievals > 0 ? Math.round((successfulRetrievals / totalRetrievals) * 10000) / 100 : 0,
    };
  }

  /**
   * Aggregate metrics by service type for each date
   * Groups by dailyBucket and separates by service type (DIRECT_SP, IPFS_PIN)
   *
   * @private
   */
  private aggregateByServiceType(metrics: MetricsDaily[]): ServiceComparisonMetricsDto[] {
    const dateServiceMap = new Map<string, Map<ServiceType, MetricsDaily[]>>();

    for (const metric of metrics) {
      const dateKey = metric.dailyBucket.toISOString().split("T")[0];

      let serviceMap = dateServiceMap.get(dateKey);
      if (!serviceMap) {
        serviceMap = new Map<ServiceType, MetricsDaily[]>();
        dateServiceMap.set(dateKey, serviceMap);
      }

      let serviceMetrics = serviceMap.get(metric.serviceType);
      if (!serviceMetrics) {
        serviceMetrics = [];
        serviceMap.set(metric.serviceType, serviceMetrics);
      }

      serviceMetrics.push(metric);
    }

    const aggregateService = (serviceMetrics: MetricsDaily[] | undefined): ServiceMetrics => {
      if (!serviceMetrics || serviceMetrics.length === 0) {
        return {
          totalRetrievals: 0,
          successfulRetrievals: 0,
          successRate: 0,
          avgLatencyMs: 0,
          avgTtfbMs: 0,
          avgThroughputBps: 0,
          totalDataRetrievedBytes: "0",
        };
      }

      let totalRetrievals = 0;
      let successfulRetrievals = 0;
      let latencySum = 0;
      let latencyCount = 0;
      let ttfbSum = 0;
      let ttfbCount = 0;
      let throughputSum = 0;
      let throughputCount = 0;
      let totalDataBytes = BigInt(0);

      for (const m of serviceMetrics) {
        totalRetrievals += m.totalRetrievals || 0;
        successfulRetrievals += m.successfulRetrievals || 0;

        if (m.avgRetrievalLatencyMs) {
          latencySum += m.avgRetrievalLatencyMs;
          latencyCount++;
        }

        if (m.avgRetrievalTtfbMs) {
          ttfbSum += m.avgRetrievalTtfbMs;
          ttfbCount++;
        }

        if (m.avgRetrievalThroughputBps) {
          throughputSum += m.avgRetrievalThroughputBps;
          throughputCount++;
        }

        totalDataBytes += BigInt(m.totalDataRetrievedBytes || 0);
      }

      return {
        totalRetrievals,
        successfulRetrievals,
        successRate: totalRetrievals > 0 ? Math.round((successfulRetrievals / totalRetrievals) * 10000) / 100 : 0,
        avgLatencyMs: latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0,
        avgTtfbMs: ttfbCount > 0 ? Math.round(ttfbSum / ttfbCount) : 0,
        avgThroughputBps: throughputCount > 0 ? Math.round(throughputSum / throughputCount) : 0,
        totalDataRetrievedBytes: totalDataBytes.toString(),
      };
    };

    const aggregated: ServiceComparisonMetricsDto[] = [];

    for (const [date, serviceMap] of dateServiceMap) {
      aggregated.push({
        date,
        directSp: aggregateService(serviceMap.get(ServiceType.DIRECT_SP)),
        ipfsPin: aggregateService(serviceMap.get(ServiceType.IPFS_PIN)),
      });
    }

    return aggregated.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Calculate summary statistics for service comparison
   *
   * @private
   */
  private calculateServiceSummary(dailyMetrics: ServiceComparisonMetricsDto[]) {
    let directSpTotalRetrievals = 0;
    let ipfsPinTotalRetrievals = 0;

    let directSpSuccessRateSum = 0;
    let directSpSuccessRateCount = 0;
    let ipfsPinSuccessRateSum = 0;
    let ipfsPinSuccessRateCount = 0;

    for (const day of dailyMetrics) {
      directSpTotalRetrievals += day.directSp.totalRetrievals;
      ipfsPinTotalRetrievals += day.ipfsPin.totalRetrievals;

      if (day.directSp.totalRetrievals > 0) {
        directSpSuccessRateSum += day.directSp.successRate;
        directSpSuccessRateCount++;
      }

      if (day.ipfsPin.totalRetrievals > 0) {
        ipfsPinSuccessRateSum += day.ipfsPin.successRate;
        ipfsPinSuccessRateCount++;
      }
    }

    return {
      totalDays: dailyMetrics.length,
      directSpTotalRetrievals,
      ipfsPinTotalRetrievals,
      directSpAvgSuccessRate:
        directSpSuccessRateCount > 0 ? Math.round((directSpSuccessRateSum / directSpSuccessRateCount) * 100) / 100 : 0,
      ipfsPinAvgSuccessRate:
        ipfsPinSuccessRateCount > 0 ? Math.round((ipfsPinSuccessRateSum / ipfsPinSuccessRateCount) * 100) / 100 : 0,
    };
  }

  /**
   * Validate date range
   *
   * @private
   */
  private validateDateRange(startDate: Date, endDate: Date, maxDays: number): void {
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new BadRequestException("Invalid date format. Use ISO 8601 format (YYYY-MM-DD).");
    }

    if (startDate > endDate) {
      throw new BadRequestException("Start date must be before or equal to end date.");
    }

    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff > maxDays) {
      throw new BadRequestException(`Date range cannot exceed ${maxDays} days.`);
    }
  }

  /**
   * Get empty response for no data
   *
   * @private
   */
  private getEmptyDailyMetricsResponse(startDate: Date, endDate: Date): DailyMetricsResponseDto {
    return {
      dailyMetrics: [],
      dateRange: {
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
      },
      summary: {
        totalDays: 0,
        totalProviders: 0,
        totalDeals: 0,
        totalRetrievals: 0,
        avgDealSuccessRate: 0,
        avgRetrievalSuccessRate: 0,
      },
    };
  }

  /**
   * Get empty provider response for no data
   *
   * @private
   */
  private getEmptyProviderDailyMetricsResponse(
    spAddress: string,
    startDate: Date,
    endDate: Date,
  ): ProviderDailyMetricsResponseDto {
    return {
      spAddress,
      dailyMetrics: [],
      dateRange: {
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
      },
      summary: {
        totalDays: 0,
        totalDeals: 0,
        totalRetrievals: 0,
        avgDealSuccessRate: 0,
        avgRetrievalSuccessRate: 0,
      },
    };
  }

  /**
   * Get empty service comparison response for no data
   *
   * @private
   */
  private getEmptyServiceComparisonResponse(startDate: Date, endDate: Date): ServiceComparisonResponseDto {
    return {
      dailyMetrics: [],
      dateRange: {
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
      },
      summary: {
        totalDays: 0,
        directSpTotalRetrievals: 0,
        ipfsPinTotalRetrievals: 0,
        directSpAvgSuccessRate: 0,
        ipfsPinAvgSuccessRate: 0,
      },
    };
  }
}
