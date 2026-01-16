import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { SpPerformanceAllTime } from "../../database/entities/sp-performance-all-time.entity.js";
import { StorageProvider } from "../../database/entities/storage-provider.entity.js";
import type { NetworkOverallStatsDto } from "../dto/network-stats.dto.js";

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
    @InjectRepository(StorageProvider)
    private readonly spRepo: Repository<StorageProvider>,
  ) {}

  /**
   * Get overall network statistics
   * Uses database-level aggregation for optimal performance
   *
   * @param options - Filter options for providers
   * @param options.approvedOnly - Only include approved providers
   * @param options.activeOnly - Only include active providers
   * @returns Overall network statistics
   */
  async getOverallStats(options?: { approvedOnly?: boolean; activeOnly?: boolean }): Promise<NetworkOverallStatsDto> {
    try {
      // Count providers from storage_providers table (with filters applied)
      const providerCountQuery = this.spRepo.createQueryBuilder("provider");
      if (options?.approvedOnly) {
        providerCountQuery.andWhere("provider.is_approved = true");
      }
      if (options?.activeOnly) {
        providerCountQuery.andWhere("provider.is_active = true");
      }
      const totalProviders = await providerCountQuery.getCount();

      // Count approved providers (with filters applied)
      const approvedCountQuery = this.spRepo.createQueryBuilder("provider").where("provider.is_approved = true");
      if (options?.activeOnly) {
        approvedCountQuery.andWhere("provider.is_active = true");
      }
      const approvedProviders = await approvedCountQuery.getCount();

      // Build query for performance metrics with optional filters
      const query = this.allTimeRepo
        .createQueryBuilder("sp")
        .innerJoin("storage_providers", "provider", "provider.address = sp.sp_address")
        .select("1", "dummy")
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
          "ROUND(AVG(sp.avg_retrieval_throughput_bps) FILTER (WHERE sp.avg_retrieval_throughput_bps IS NOT NULL))",
          "avgRetrievalThroughputBps",
        )
        .addSelect("MAX(sp.refreshed_at)", "lastRefreshedAt");

      // Apply filters if provided
      if (options?.approvedOnly) {
        query.andWhere("provider.is_approved = true");
      }

      if (options?.activeOnly) {
        query.andWhere("provider.is_active = true");
      }

      const stats = await query.getRawOne();

      // Handle empty result - if no providers exist, return empty stats
      if (totalProviders === 0) {
        return this.getEmptyOverallStats();
      }

      // Handle case where providers exist but no performance data
      if (!stats) {
        return {
          ...this.getEmptyOverallStats(),
          totalProviders,
          approvedProviders,
        };
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
        totalProviders,
        approvedProviders,
        totalDeals,
        successfulDeals,
        dealSuccessRate: Math.round(dealSuccessRate * 100) / 100,
        totalRetrievals,
        successfulRetrievals,
        retrievalSuccessRate: Math.round(retrievalSuccessRate * 100) / 100,
        totalDataStoredBytes: String(stats.totalDataStoredBytes || "0"),
        totalDataRetrievedBytes: String(stats.totalDataRetrievedBytes || "0"),
        avgDealLatencyMs: Math.round(Number(stats.avgDealLatencyMs || 0)),
        avgIngestLatencyMs: Math.round(Number(stats.avgDealIngestLatencyMs || 0)),
        avgChainLatencyMs: Math.round(Number(stats.avgDealChainLatencyMs || 0)),
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
   * Get empty overall stats
   *
   * @private
   */
  private getEmptyOverallStats(): NetworkOverallStatsDto {
    return {
      totalProviders: 0,
      approvedProviders: 0,
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
}
