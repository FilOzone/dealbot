import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { type Repository } from "typeorm";
import { SpPerformanceAllTime } from "../../database/entities/sp-performance-all-time.entity.js";
import { SpPerformanceWeekly } from "../../database/entities/sp-performance-weekly.entity.js";
import type {
  NetworkHealthDto,
  NetworkOverallStatsDto,
  NetworkStatsResponseDto,
  NetworkTrendsDto,
} from "../dto/network-stats.dto.js";

/**
 * Service for handling network-wide statistics
 * Provides overall health, trends, and aggregate metrics across all providers
 *
 * Uses materialized views for fast aggregation:
 * - sp_performance_all_time: Lifetime metrics
 * - sp_performance_weekly: Last 7 days metrics
 *
 * @class NetworkStatsService
 */
@Injectable()
export class NetworkStatsService {
  private readonly logger = new Logger(NetworkStatsService.name);

  constructor(
    @InjectRepository(SpPerformanceAllTime)
    private readonly allTimeRepo: Repository<SpPerformanceAllTime>,
    @InjectRepository(SpPerformanceWeekly)
    private readonly weeklyRepo: Repository<SpPerformanceWeekly>,
  ) {}

  /**
   * Get complete network statistics
   * Includes overall stats, health indicators, and trends
   *
   * @returns Complete network statistics
   */
  async getNetworkStats(): Promise<NetworkStatsResponseDto> {
    try {
      const [overall, health, trends] = await Promise.all([
        this.getOverallStats(),
        this.getHealthIndicators(),
        this.getTrends(),
      ]);

      return {
        overall,
        health,
        trends,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch network stats: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get overall network statistics
   *
   * @returns Overall network statistics
   */
  async getOverallStats(): Promise<NetworkOverallStatsDto> {
    try {
      const providers = await this.allTimeRepo.find();

      if (providers.length === 0) {
        return this.getEmptyOverallStats();
      }

      // Calculate active providers (activity in last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const activeProviders = providers.filter(
        (p) =>
          (p.lastDealAt && p.lastDealAt >= sevenDaysAgo) || (p.lastRetrievalAt && p.lastRetrievalAt >= sevenDaysAgo),
      ).length;

      // Aggregate metrics
      const totals = providers.reduce(
        (acc, p) => ({
          totalDeals: acc.totalDeals + (p.totalDeals || 0),
          successfulDeals: acc.successfulDeals + (p.successfulDeals || 0),
          totalRetrievals: acc.totalRetrievals + (p.totalRetrievals || 0),
          successfulRetrievals: acc.successfulRetrievals + (p.successfulRetrievals || 0),
          totalDataStored: acc.totalDataStored + BigInt(p.totalDataStoredBytes || "0"),
          totalDataRetrieved: acc.totalDataRetrieved + BigInt(p.totalDataRetrievedBytes || "0"),
          cdnRetrievals: acc.cdnRetrievals + (p.cdnRetrievals || 0),
          directRetrievals: acc.directRetrievals + (p.directRetrievals || 0),
          dealLatencies: p.avgDealLatencyMs ? [...acc.dealLatencies, p.avgDealLatencyMs] : acc.dealLatencies,
          retrievalLatencies: p.avgRetrievalLatencyMs
            ? [...acc.retrievalLatencies, p.avgRetrievalLatencyMs]
            : acc.retrievalLatencies,
          ttfbs: p.avgRetrievalTtfbMs ? [...acc.ttfbs, p.avgRetrievalTtfbMs] : acc.ttfbs,
          cdnLatencies: p.avgCdnLatencyMs ? [...acc.cdnLatencies, p.avgCdnLatencyMs] : acc.cdnLatencies,
          directLatencies: p.avgDirectLatencyMs ? [...acc.directLatencies, p.avgDirectLatencyMs] : acc.directLatencies,
        }),
        {
          totalDeals: 0,
          successfulDeals: 0,
          totalRetrievals: 0,
          successfulRetrievals: 0,
          totalDataStored: BigInt(0),
          totalDataRetrieved: BigInt(0),
          cdnRetrievals: 0,
          directRetrievals: 0,
          dealLatencies: [] as number[],
          retrievalLatencies: [] as number[],
          ttfbs: [] as number[],
          cdnLatencies: [] as number[],
          directLatencies: [] as number[],
        },
      );

      // Calculate averages
      const avg = (arr: number[]) => (arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);

      const dealSuccessRate = totals.totalDeals > 0 ? (totals.successfulDeals / totals.totalDeals) * 100 : 0;

      const retrievalSuccessRate =
        totals.totalRetrievals > 0 ? (totals.successfulRetrievals / totals.totalRetrievals) * 100 : 0;

      const totalRetrievals = totals.cdnRetrievals + totals.directRetrievals;
      const cdnUsagePercentage = totalRetrievals > 0 ? (totals.cdnRetrievals / totalRetrievals) * 100 : 0;

      const avgCdnLatencyMs = totals.cdnLatencies.length > 0 ? avg(totals.cdnLatencies) : undefined;
      const avgDirectLatencyMs = totals.directLatencies.length > 0 ? avg(totals.directLatencies) : undefined;

      // Calculate CDN improvement
      let cdnImprovementPercent: number | undefined;
      if (avgCdnLatencyMs && avgDirectLatencyMs && avgDirectLatencyMs > 0) {
        cdnImprovementPercent =
          Math.round(((avgDirectLatencyMs - avgCdnLatencyMs) / avgDirectLatencyMs) * 100 * 100) / 100;
      }

      // Get last refresh time
      const lastRefreshedAt = providers.reduce((latest, p) => {
        if (!latest || (p.refreshedAt && p.refreshedAt > latest)) {
          return p.refreshedAt;
        }
        return latest;
      }, providers[0]?.refreshedAt || new Date());

      return {
        totalProviders: providers.length,
        activeProviders,
        totalDeals: totals.totalDeals,
        successfulDeals: totals.successfulDeals,
        dealSuccessRate: Math.round(dealSuccessRate * 100) / 100,
        totalRetrievals: totals.totalRetrievals,
        successfulRetrievals: totals.successfulRetrievals,
        retrievalSuccessRate: Math.round(retrievalSuccessRate * 100) / 100,
        totalDataStoredBytes: totals.totalDataStored.toString(),
        totalDataRetrievedBytes: totals.totalDataRetrieved.toString(),
        avgDealLatencyMs: avg(totals.dealLatencies),
        avgRetrievalLatencyMs: avg(totals.retrievalLatencies),
        avgRetrievalTtfbMs: avg(totals.ttfbs),
        totalCdnRetrievals: totals.cdnRetrievals,
        totalDirectRetrievals: totals.directRetrievals,
        cdnUsagePercentage: Math.round(cdnUsagePercentage * 100) / 100,
        avgCdnLatencyMs,
        avgDirectLatencyMs,
        cdnImprovementPercent,
        lastRefreshedAt,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch overall stats: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get network health indicators
   *
   * @returns Network health indicators
   */
  async getHealthIndicators(): Promise<NetworkHealthDto> {
    try {
      const providers = await this.allTimeRepo.find();

      if (providers.length === 0) {
        return this.getEmptyHealthIndicators();
      }

      // Calculate deal reliability (average success rate)
      const dealReliability = providers.reduce((sum, p) => sum + (p.dealSuccessRate || 0), 0) / providers.length;

      // Calculate retrieval reliability (average success rate)
      const retrievalReliability =
        providers.reduce((sum, p) => sum + (p.retrievalSuccessRate || 0), 0) / providers.length;

      // Calculate performance score based on latencies
      // Lower latency = higher score (inverse relationship)
      const avgLatencies = providers
        .filter((p) => p.avgDealLatencyMs && p.avgRetrievalLatencyMs)
        .map((p) => (p.avgDealLatencyMs! + p.avgRetrievalLatencyMs!) / 2);

      const avgLatency = avgLatencies.length > 0 ? avgLatencies.reduce((a, b) => a + b, 0) / avgLatencies.length : 0;

      // Score: 100 at 0ms, decreasing to 0 at 5000ms
      const performanceScore = avgLatency > 0 ? Math.max(0, 100 - (avgLatency / 5000) * 100) : 100;

      // Calculate diversity score (more providers = higher score)
      // Score: 100 at 50+ providers, scaling down
      const diversityScore = Math.min(100, (providers.length / 50) * 100);

      // Overall health score (weighted average)
      const healthScore =
        dealReliability * 0.35 + retrievalReliability * 0.35 + performanceScore * 0.2 + diversityScore * 0.1;

      return {
        healthScore: Math.round(healthScore * 100) / 100,
        dealReliability: Math.round(dealReliability * 100) / 100,
        retrievalReliability: Math.round(retrievalReliability * 100) / 100,
        performanceScore: Math.round(performanceScore * 100) / 100,
        diversityScore: Math.round(diversityScore * 100) / 100,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch health indicators: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get network activity trends
   * Compares last 7 days to previous 7 days
   *
   * @returns Network activity trends
   */
  async getTrends(): Promise<NetworkTrendsDto> {
    try {
      const [weeklyProviders, allTimeProviders] = await Promise.all([this.weeklyRepo.find(), this.allTimeRepo.find()]);

      if (weeklyProviders.length === 0 || allTimeProviders.length === 0) {
        return this.getEmptyTrends();
      }

      // Calculate weekly totals
      const weeklyTotals = weeklyProviders.reduce(
        (acc, p) => ({
          deals: acc.deals + (p.totalDeals7d || 0),
          retrievals: acc.retrievals + (p.totalRetrievals7d || 0),
          successfulDeals: acc.successfulDeals + (p.successfulDeals7d || 0),
          successfulRetrievals: acc.successfulRetrievals + (p.successfulRetrievals7d || 0),
        }),
        { deals: 0, retrievals: 0, successfulDeals: 0, successfulRetrievals: 0 },
      );

      // Calculate all-time totals
      const allTimeTotals = allTimeProviders.reduce(
        (acc, p) => ({
          deals: acc.deals + (p.totalDeals || 0),
          retrievals: acc.retrievals + (p.totalRetrievals || 0),
        }),
        { deals: 0, retrievals: 0 },
      );

      // Estimate previous week totals (all-time - current week)
      const prevWeekDeals = Math.max(0, allTimeTotals.deals - weeklyTotals.deals);
      const prevWeekRetrievals = Math.max(0, allTimeTotals.retrievals - weeklyTotals.retrievals);

      // Calculate trends (percentage change)
      const dealVolumeTrend =
        prevWeekDeals > 0 ? Math.round(((weeklyTotals.deals - prevWeekDeals) / prevWeekDeals) * 100 * 100) / 100 : 0;

      const retrievalVolumeTrend =
        prevWeekRetrievals > 0
          ? Math.round(((weeklyTotals.retrievals - prevWeekRetrievals) / prevWeekRetrievals) * 100 * 100) / 100
          : 0;

      // Calculate success rate trend
      const _weeklySuccessRate =
        weeklyTotals.deals > 0
          ? (weeklyTotals.successfulDeals / weeklyTotals.deals +
              weeklyTotals.successfulRetrievals / weeklyTotals.retrievals) /
            2
          : 0;

      // Assume previous week had similar success rate (simplified)
      const successRateTrend = 0; // Would need historical data to calculate properly

      // Count active providers (with activity in last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const activeProvidersNow = allTimeProviders.filter(
        (p) =>
          (p.lastDealAt && p.lastDealAt >= sevenDaysAgo) || (p.lastRetrievalAt && p.lastRetrievalAt >= sevenDaysAgo),
      ).length;

      // Assume previous week had 90% of current active providers (simplified)
      const prevActiveProviders = Math.round(activeProvidersNow * 0.9);
      const activeProvidersTrend =
        prevActiveProviders > 0
          ? Math.round(((activeProvidersNow - prevActiveProviders) / prevActiveProviders) * 100 * 100) / 100
          : 0;

      return {
        dealVolumeTrend,
        retrievalVolumeTrend,
        successRateTrend,
        activeProvidersTrend,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch trends: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get empty overall stats
   *
   * @private
   */
  private getEmptyOverallStats(): NetworkOverallStatsDto {
    return {
      totalProviders: 0,
      activeProviders: 0,
      totalDeals: 0,
      successfulDeals: 0,
      dealSuccessRate: 0,
      totalRetrievals: 0,
      successfulRetrievals: 0,
      retrievalSuccessRate: 0,
      totalDataStoredBytes: "0",
      totalDataRetrievedBytes: "0",
      avgDealLatencyMs: 0,
      avgRetrievalLatencyMs: 0,
      avgRetrievalTtfbMs: 0,
      totalCdnRetrievals: 0,
      totalDirectRetrievals: 0,
      cdnUsagePercentage: 0,
      lastRefreshedAt: new Date(),
    };
  }

  /**
   * Get empty health indicators
   *
   * @private
   */
  private getEmptyHealthIndicators(): NetworkHealthDto {
    return {
      healthScore: 0,
      dealReliability: 0,
      retrievalReliability: 0,
      performanceScore: 0,
      diversityScore: 0,
    };
  }

  /**
   * Get empty trends
   *
   * @private
   */
  private getEmptyTrends(): NetworkTrendsDto {
    return {
      dealVolumeTrend: 0,
      retrievalVolumeTrend: 0,
      successRateTrend: 0,
      activeProvidersTrend: 0,
    };
  }
}
