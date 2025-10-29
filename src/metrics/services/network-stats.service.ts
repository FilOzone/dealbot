import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { type Repository } from "typeorm";
import { SpPerformanceAllTime } from "../../database/entities/sp-performance-all-time.entity.js";
import type { NetworkHealthDto, NetworkOverallStatsDto, NetworkStatsResponseDto } from "../dto/network-stats.dto.js";

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
  ) {}

  /**
   * Get complete network statistics
   * Includes overall stats, health indicators, and trends
   *
   * @returns Complete network statistics
   */
  async getNetworkStats(): Promise<NetworkStatsResponseDto> {
    try {
      const [overall, health] = await Promise.all([this.getOverallStats(), this.getHealthIndicators()]);

      return {
        overall,
        health,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch network stats: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get overall network statistics
   * Uses database-level aggregation for optimal performance
   *
   * @returns Overall network statistics
   */
  async getOverallStats(): Promise<NetworkOverallStatsDto> {
    try {
      // Calculate active providers threshold (7 days ago)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // Single query with database-level aggregation
      const stats = await this.allTimeRepo
        .createQueryBuilder("sp")
        .select("COUNT(DISTINCT sp.sp_address)", "totalProviders")
        .addSelect(
          "COUNT(DISTINCT sp.sp_address) FILTER (WHERE sp.total_deals > 0 OR sp.total_retrievals > 0)",
          "activeProviders",
        )
        .addSelect("COALESCE(SUM(sp.total_deals), 0)", "totalDeals")
        .addSelect("COALESCE(SUM(sp.successful_deals), 0)", "successfulDeals")
        .addSelect("COALESCE(SUM(sp.total_retrievals), 0)", "totalRetrievals")
        .addSelect("COALESCE(SUM(sp.successful_retrievals), 0)", "successfulRetrievals")
        .addSelect("COALESCE(SUM(sp.total_data_stored_bytes), 0)", "totalDataStoredBytes")
        .addSelect("COALESCE(SUM(sp.total_data_retrieved_bytes), 0)", "totalDataRetrievedBytes")
        .addSelect(
          "ROUND(AVG(sp.avg_deal_latency_ms) FILTER (WHERE sp.avg_deal_latency_ms IS NOT NULL))",
          "avgDealLatencyMs",
        )
        .addSelect(
          "ROUND(AVG(sp.avg_ingest_latency_ms) FILTER (WHERE sp.avg_ingest_latency_ms IS NOT NULL))",
          "avgDealIngestLatencyMs",
        )
        .addSelect(
          "ROUND(AVG(sp.avg_chain_latency_ms) FILTER (WHERE sp.avg_chain_latency_ms IS NOT NULL))",
          "avgDealChainLatencyMs",
        )
        .addSelect(
          "ROUND(AVG(sp.avg_retrieval_latency_ms) FILTER (WHERE sp.avg_retrieval_latency_ms IS NOT NULL))",
          "avgRetrievalLatencyMs",
        )
        .addSelect(
          "ROUND(AVG(sp.avg_retrieval_ttfb_ms) FILTER (WHERE sp.avg_retrieval_ttfb_ms IS NOT NULL))",
          "avgRetrievalTtfbMs",
        )
        .addSelect(
          "ROUND(AVG(sp.avg_ingest_throughput_bps) FILTER (WHERE sp.avg_ingest_throughput_bps IS NOT NULL))",
          "avgIngestThroughputBps",
        )
        .addSelect(
          "ROUND(AVG(sp.avg_throughput_bps) FILTER (WHERE sp.avg_throughput_bps IS NOT NULL))",
          "avgRetrievalThroughputBps",
        )
        .addSelect("MAX(sp.refreshed_at)", "lastRefreshedAt")
        .setParameter("sevenDaysAgo", sevenDaysAgo)
        .getRawOne();

      // Handle empty result
      if (!stats || stats.totalProviders === "0" || stats.totalProviders === 0) {
        return this.getEmptyOverallStats();
      }

      // Parse numeric values (handle potential string returns from DB)
      const totalDeals = Number(stats.totalDeals || 0);
      const successfulDeals = Number(stats.successfulDeals || 0);
      const totalRetrievals = Number(stats.totalRetrievals || 0);
      const successfulRetrievals = Number(stats.successfulRetrievals || 0);

      // Calculate success rates
      const dealSuccessRate = totalDeals > 0 ? (successfulDeals / totalDeals) * 100 : 0;
      const retrievalSuccessRate = totalRetrievals > 0 ? (successfulRetrievals / totalRetrievals) * 100 : 0;

      return {
        totalProviders: Number(stats.totalProviders || 0),
        activeProviders: Number(stats.activeProviders || 0),
        totalDeals,
        successfulDeals,
        dealSuccessRate: Math.round(dealSuccessRate * 100) / 100,
        totalRetrievals,
        successfulRetrievals,
        retrievalSuccessRate: Math.round(retrievalSuccessRate * 100) / 100,
        totalDataStoredBytes: String(stats.totalDataStoredBytes || "0"),
        totalDataRetrievedBytes: String(stats.totalDataRetrievedBytes || "0"),
        avgDealLatencyMs: Math.round(Number(stats.avgDealLatencyMs || 0)),
        avgIngestLatencyMs: Math.round(Number(stats.avgIngestLatencyMs || 0)),
        avgChainLatencyMs: Math.round(Number(stats.avgChainLatencyMs || 0)),
        avgRetrievalLatencyMs: Math.round(Number(stats.avgRetrievalLatencyMs || 0)),
        avgRetrievalTtfbMs: Math.round(Number(stats.avgRetrievalTtfbMs || 0)),
        avgIngestThroughputBps: Math.round(Number(stats.avgIngestThroughputBps || 0)),
        avgRetrievalThroughputBps: Math.round(Number(stats.avgRetrievalThroughputBps || 0)),
        lastRefreshedAt: stats.lastRefreshedAt || new Date(),
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
      avgIngestLatencyMs: 0,
      avgChainLatencyMs: 0,
      avgRetrievalLatencyMs: 0,
      avgRetrievalTtfbMs: 0,
      avgIngestThroughputBps: 0,
      avgRetrievalThroughputBps: 0,
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
}
