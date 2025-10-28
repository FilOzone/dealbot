import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Between, type Repository } from "typeorm";
import { MetricsDaily } from "../../database/entities/metrics-daily.entity.js";
import { ServiceType } from "../../database/types.js";
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
 * - serviceType (CDN, DIRECT, IPFS)
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
      this.logger.error(`Failed to fetch daily metrics: ${error.message}`, error.stack);
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
      this.logger.error(`Failed to fetch provider daily metrics for ${spAddress}: ${error.message}`, error.stack);
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
   * Breaks down retrieval metrics by service type (CDN, DIRECT_SP, IPFS_PIN)
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

      // Filter to only retrieval metrics (service_type not null)
      const retrievalMetrics = metrics.filter((m) => m.serviceType !== null);

      // Group by date and aggregate by service type
      const dailyMetrics = this.aggregateByServiceType(retrievalMetrics);
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
      this.logger.error(`Failed to fetch service comparison: ${error.message}`, error.stack);
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
    const dateMap = new Map<string, MetricsDaily[]>();

    // Group metrics by date
    metrics.forEach((metric) => {
      const dateKey = metric.dailyBucket.toISOString().split("T")[0];
      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, []);
      }
      dateMap.get(dateKey)!.push(metric);
    });

    // Aggregate for each date
    const aggregated: DailyAggregatedMetricsDto[] = [];

    dateMap.forEach((dayMetrics, date) => {
      // Aggregate totals
      const totalDeals = dayMetrics.reduce((sum, m) => sum + (m.totalDeals || 0), 0);
      const successfulDeals = dayMetrics.reduce((sum, m) => sum + (m.successfulDeals || 0), 0);
      const totalRetrievals = dayMetrics.reduce((sum, m) => sum + (m.totalRetrievals || 0), 0);
      const successfulRetrievals = dayMetrics.reduce((sum, m) => sum + (m.successfulRetrievals || 0), 0);

      // Collect latencies for averaging
      const dealLatencies = dayMetrics
        .filter((m) => m.serviceType === null && m.avgDealLatencyMs)
        .map((m) => m.avgDealLatencyMs);

      const retrievalLatencies = dayMetrics.filter((m) => m.avgRetrievalLatencyMs).map((m) => m.avgRetrievalLatencyMs);

      const retrievalTtfbs = dayMetrics.filter((m) => m.avgRetrievalTtfbMs).map((m) => m.avgRetrievalTtfbMs);

      // Get unique providers (from deal metrics only to avoid double counting)
      const uniqueProviders = new Set(dayMetrics.filter((m) => m.serviceType === null).map((m) => m.spAddress)).size;

      // Helper function to calculate average
      const avg = (arr: number[]) => (arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);

      // Calculate total data stored/retrieved
      const totalDataStoredBytes = dayMetrics
        .filter((m) => m.serviceType === null)
        .reduce((sum, m) => sum + BigInt(m.totalDataStoredBytes || 0), BigInt(0))
        .toString();

      const totalDataRetrievedBytes = dayMetrics
        .reduce((sum, m) => sum + BigInt(m.totalDataRetrievedBytes || 0), BigInt(0))
        .toString();

      aggregated.push({
        date,
        totalDeals,
        successfulDeals,
        dealSuccessRate: totalDeals > 0 ? Math.round((successfulDeals / totalDeals) * 100 * 100) / 100 : 0,
        totalRetrievals,
        successfulRetrievals,
        retrievalSuccessRate:
          totalRetrievals > 0 ? Math.round((successfulRetrievals / totalRetrievals) * 100 * 100) / 100 : 0,
        avgDealLatencyMs: avg(dealLatencies),
        avgRetrievalLatencyMs: avg(retrievalLatencies),
        avgRetrievalTtfbMs: avg(retrievalTtfbs),
        totalDataStoredBytes,
        totalDataRetrievedBytes,
        uniqueProviders,
      });
    });

    return aggregated.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Map metrics to provider daily metrics DTOs
   * Aggregates across service types for each provider-date combination
   *
   * @private
   */
  private mapToProviderDailyMetrics(metrics: MetricsDaily[]): ProviderDailyMetricsDto[] {
    const dateMap = new Map<string, MetricsDaily[]>();

    // Group by date
    metrics.forEach((metric) => {
      const dateKey = metric.dailyBucket.toISOString().split("T")[0];
      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, []);
      }
      dateMap.get(dateKey)!.push(metric);
    });

    // Aggregate for each date
    const result: ProviderDailyMetricsDto[] = [];

    dateMap.forEach((dayMetrics, date) => {
      // Aggregate across service types for this provider-date
      const dealMetrics = dayMetrics.filter((m) => m.serviceType === null);
      const retrievalMetrics = dayMetrics.filter((m) => m.serviceType !== null);

      const totalDeals = dealMetrics.reduce((sum, m) => sum + (m.totalDeals || 0), 0);
      const successfulDeals = dealMetrics.reduce((sum, m) => sum + (m.successfulDeals || 0), 0);
      const totalRetrievals = retrievalMetrics.reduce((sum, m) => sum + (m.totalRetrievals || 0), 0);
      const successfulRetrievals = retrievalMetrics.reduce((sum, m) => sum + (m.successfulRetrievals || 0), 0);

      const dealLatencies = dealMetrics.filter((m) => m.avgDealLatencyMs).map((m) => m.avgDealLatencyMs);
      const injestLatencies = dealMetrics.filter((m) => m.avgIngestLatencyMs).map((m) => m.avgIngestLatencyMs);

      const retrievalLatencies = retrievalMetrics
        .filter((m) => m.avgRetrievalLatencyMs)
        .map((m) => m.avgRetrievalLatencyMs);
      const retrievalThroughputBps = retrievalMetrics
        .filter((m) => m.avgRetrievalThroughputBps)
        .map((m) => m.avgRetrievalThroughputBps);

      const avg = (arr: number[]) => (arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);

      result.push({
        date,
        spAddress: dayMetrics[0].spAddress,
        totalDeals,
        successfulDeals,
        dealSuccessRate: totalDeals > 0 ? Math.round((successfulDeals / totalDeals) * 100 * 100) / 100 : 0,
        totalRetrievals,
        successfulRetrievals,
        retrievalSuccessRate:
          totalRetrievals > 0 ? Math.round((successfulRetrievals / totalRetrievals) * 100 * 100) / 100 : 0,
        avgDealLatencyMs: avg(dealLatencies),
        avgIngestLatencyMs: avg(injestLatencies),
        avgRetrievalLatencyMs: avg(retrievalLatencies),
        avgRetrievalThroughputBps: avg(retrievalThroughputBps),
      });
    });

    return result.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Calculate summary statistics
   *
   * @private
   */
  private calculateSummary(dailyMetrics: DailyAggregatedMetricsDto[], rawMetrics: MetricsDaily[]) {
    const totalDeals = dailyMetrics.reduce((sum, day) => sum + day.totalDeals, 0);
    const totalRetrievals = dailyMetrics.reduce((sum, day) => sum + day.totalRetrievals, 0);
    const successfulDeals = dailyMetrics.reduce((sum, day) => sum + day.successfulDeals, 0);
    const successfulRetrievals = dailyMetrics.reduce((sum, day) => sum + day.successfulRetrievals, 0);

    // Count unique providers from deal metrics only (service_type=null) to avoid double counting
    const uniqueProviders = new Set(rawMetrics.filter((m) => m.serviceType === null).map((m) => m.spAddress)).size;

    return {
      totalDays: dailyMetrics.length,
      totalProviders: uniqueProviders,
      totalDeals,
      totalRetrievals,
      avgDealSuccessRate: totalDeals > 0 ? Math.round((successfulDeals / totalDeals) * 100 * 100) / 100 : 0,
      avgRetrievalSuccessRate:
        totalRetrievals > 0 ? Math.round((successfulRetrievals / totalRetrievals) * 100 * 100) / 100 : 0,
    };
  }

  /**
   * Calculate provider-specific summary
   *
   * @private
   */
  private calculateProviderSummary(dailyMetrics: ProviderDailyMetricsDto[]) {
    const totalDeals = dailyMetrics.reduce((sum, day) => sum + day.totalDeals, 0);
    const totalRetrievals = dailyMetrics.reduce((sum, day) => sum + day.totalRetrievals, 0);
    const successfulDeals = dailyMetrics.reduce((sum, day) => sum + day.successfulDeals, 0);
    const successfulRetrievals = dailyMetrics.reduce((sum, day) => sum + day.successfulRetrievals, 0);

    return {
      totalDays: dailyMetrics.length,
      totalDeals,
      totalRetrievals,
      avgDealSuccessRate: totalDeals > 0 ? Math.round((successfulDeals / totalDeals) * 100 * 100) / 100 : 0,
      avgRetrievalSuccessRate:
        totalRetrievals > 0 ? Math.round((successfulRetrievals / totalRetrievals) * 100 * 100) / 100 : 0,
    };
  }

  /**
   * Aggregate metrics by service type for each date
   * Groups by dailyBucket and separates by service type (CDN, DIRECT_SP, IPFS_PIN)
   *
   * @private
   */
  private aggregateByServiceType(metrics: MetricsDaily[]): ServiceComparisonMetricsDto[] {
    const dateMap = new Map<string, MetricsDaily[]>();

    // Group metrics by date
    metrics.forEach((metric) => {
      const dateKey = metric.dailyBucket.toISOString().split("T")[0];
      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, []);
      }
      dateMap.get(dateKey)!.push(metric);
    });

    // Aggregate for each date
    const aggregated: ServiceComparisonMetricsDto[] = [];

    dateMap.forEach((dayMetrics, date) => {
      // Separate by service type
      const cdnMetrics = dayMetrics.filter((m) => m.serviceType === ServiceType.CDN);
      const directMetrics = dayMetrics.filter((m) => m.serviceType === ServiceType.DIRECT_SP);
      const ipfsMetrics = dayMetrics.filter((m) => m.serviceType === ServiceType.IPFS_PIN);

      // Helper to aggregate service metrics
      const aggregateService = (serviceMetrics: MetricsDaily[]): ServiceMetrics => {
        const totalRetrievals = serviceMetrics.reduce((sum, m) => sum + (m.totalRetrievals || 0), 0);
        const successfulRetrievals = serviceMetrics.reduce((sum, m) => sum + (m.successfulRetrievals || 0), 0);
        const latencies = serviceMetrics.filter((m) => m.avgRetrievalLatencyMs).map((m) => m.avgRetrievalLatencyMs);
        const ttfbs = serviceMetrics.filter((m) => m.avgRetrievalTtfbMs).map((m) => m.avgRetrievalTtfbMs);

        const avg = (arr: number[]) => (arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);

        return {
          totalRetrievals,
          successfulRetrievals,
          successRate: totalRetrievals > 0 ? Math.round((successfulRetrievals / totalRetrievals) * 100 * 100) / 100 : 0,
          avgLatencyMs: avg(latencies),
          avgTtfbMs: avg(ttfbs),
          totalDataRetrievedBytes: serviceMetrics
            .reduce((sum, m) => sum + BigInt(m.totalDataRetrievedBytes || 0), BigInt(0))
            .toString(),
        };
      };

      aggregated.push({
        date,
        cdn: aggregateService(cdnMetrics),
        directSp: aggregateService(directMetrics),
        ipfsPin: aggregateService(ipfsMetrics),
      });
    });

    return aggregated.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Calculate summary statistics for service comparison
   *
   * @private
   */
  private calculateServiceSummary(dailyMetrics: ServiceComparisonMetricsDto[]) {
    const cdnTotalRetrievals = dailyMetrics.reduce((sum, day) => sum + day.cdn.totalRetrievals, 0);
    const directSpTotalRetrievals = dailyMetrics.reduce((sum, day) => sum + day.directSp.totalRetrievals, 0);
    const ipfsPinTotalRetrievals = dailyMetrics.reduce((sum, day) => sum + day.ipfsPin.totalRetrievals, 0);

    const cdnSuccessRates = dailyMetrics.filter((d) => d.cdn.totalRetrievals > 0).map((d) => d.cdn.successRate);
    const directSpSuccessRates = dailyMetrics
      .filter((d) => d.directSp.totalRetrievals > 0)
      .map((d) => d.directSp.successRate);
    const ipfsPinSuccessRates = dailyMetrics
      .filter((d) => d.ipfsPin.totalRetrievals > 0)
      .map((d) => d.ipfsPin.successRate);

    const avgRate = (arr: number[]) =>
      arr.length > 0 ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : 0;

    return {
      totalDays: dailyMetrics.length,
      cdnTotalRetrievals,
      directSpTotalRetrievals,
      ipfsPinTotalRetrievals,
      cdnAvgSuccessRate: avgRate(cdnSuccessRates),
      directSpAvgSuccessRate: avgRate(directSpSuccessRates),
      ipfsPinAvgSuccessRate: avgRate(ipfsPinSuccessRates),
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
        cdnTotalRetrievals: 0,
        directSpTotalRetrievals: 0,
        ipfsPinTotalRetrievals: 0,
        cdnAvgSuccessRate: 0,
        directSpAvgSuccessRate: 0,
        ipfsPinAvgSuccessRate: 0,
      },
    };
  }
}
