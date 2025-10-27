import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Between } from "typeorm";
import { MetricsDaily } from "../../database/entities/metrics-daily.entity.js";
import { ServiceType } from "../../database/types.js";
import {
  DailyMetricsResponseDto,
  DailyAggregatedMetricsDto,
  ProviderDailyMetricsResponseDto,
  ProviderDailyMetricsDto,
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
      // Separate by service type
      const cdnMetrics = dayMetrics.filter((m) => m.serviceType === ServiceType.CDN);
      const directMetrics = dayMetrics.filter((m) => m.serviceType === ServiceType.DIRECT_SP);
      const ipfsMetrics = dayMetrics.filter((m) => m.serviceType === ServiceType.IPFS_PIN);

      // Aggregate totals
      const totalDeals = dayMetrics.reduce((sum, m) => sum + (m.dealsInitiated || 0), 0);
      const successfulDeals = dayMetrics.reduce((sum, m) => sum + (m.dealsCompleted || 0), 0);
      const totalRetrievals = dayMetrics.reduce((sum, m) => sum + (m.retrievalsAttempted || 0), 0);
      const successfulRetrievals = dayMetrics.reduce((sum, m) => sum + (m.retrievalsSuccessful || 0), 0);

      // CDN/Direct retrieval counts
      const cdnRetrievals = cdnMetrics.reduce((sum, m) => sum + (m.retrievalsAttempted || 0), 0);
      const directRetrievals = directMetrics.reduce((sum, m) => sum + (m.retrievalsAttempted || 0), 0);

      // Collect latencies for averaging
      const dealLatencies = dayMetrics.filter((m) => m.avgDealLatencyMs).map((m) => m.avgDealLatencyMs);

      const retrievalLatencies = dayMetrics.filter((m) => m.avgRetrievalLatencyMs).map((m) => m.avgRetrievalLatencyMs);

      const cdnLatencies = cdnMetrics.filter((m) => m.avgRetrievalLatencyMs).map((m) => m.avgRetrievalLatencyMs);

      const directLatencies = directMetrics.filter((m) => m.avgRetrievalLatencyMs).map((m) => m.avgRetrievalLatencyMs);

      // Get unique providers
      const uniqueProviders = new Set(dayMetrics.map((m) => m.spAddress)).size;

      // Helper function to calculate average
      const avg = (arr: number[]) => (arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);

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
        avgRetrievalTtfbMs: 0, // TTFB not available in metrics_daily
        cdnRetrievals,
        directRetrievals,
        avgCdnLatencyMs: cdnLatencies.length > 0 ? avg(cdnLatencies) : undefined,
        avgDirectLatencyMs: directLatencies.length > 0 ? avg(directLatencies) : undefined,
        totalDataStoredBytes: "0", // Not available in metrics_daily
        totalDataRetrievedBytes: "0", // Not available in metrics_daily
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
      const totalDeals = dayMetrics.reduce((sum, m) => sum + (m.dealsInitiated || 0), 0);
      const successfulDeals = dayMetrics.reduce((sum, m) => sum + (m.dealsCompleted || 0), 0);
      const totalRetrievals = dayMetrics.reduce((sum, m) => sum + (m.retrievalsAttempted || 0), 0);
      const successfulRetrievals = dayMetrics.reduce((sum, m) => sum + (m.retrievalsSuccessful || 0), 0);

      const dealLatencies = dayMetrics.filter((m) => m.avgDealLatencyMs).map((m) => m.avgDealLatencyMs);

      const retrievalLatencies = dayMetrics.filter((m) => m.avgRetrievalLatencyMs).map((m) => m.avgRetrievalLatencyMs);

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
        avgRetrievalLatencyMs: avg(retrievalLatencies),
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

    const uniqueProviders = new Set(rawMetrics.map((m) => m.spAddress)).size;

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
   * Validate date range
   *
   * @private
   */
  private validateDateRange(startDate: Date, endDate: Date, maxDays: number): void {
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
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
}
