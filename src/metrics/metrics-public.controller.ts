import { Controller, DefaultValuePipe, Get, Logger, Param, ParseIntPipe, Query } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  NetworkStatsDto,
  type ProviderAllTimePerformanceDto,
  ProviderCombinedPerformanceDto,
  ProviderListResponseDto,
  ProviderWeeklyPerformanceDto,
} from "./dto/provider-performance.dto.js";
import { MetricsQueryService } from "./metrics-query.service.js";

/**
 * Public API controller for storage provider metrics
 *
 * Provides read-only access to pre-computed performance metrics
 * for storage provider discovery, comparison, and monitoring.
 *
 * All endpoints are public and do not require authentication.
 * Data is served from materialized views for optimal performance.
 */
@ApiTags("Provider Metrics")
@Controller("api/v1/providers")
export class MetricsPublicController {
  private readonly logger = new Logger(MetricsPublicController.name);

  constructor(private readonly metricsQueryService: MetricsQueryService) {}

  /**
   * List all storage providers with their weekly performance metrics
   * Useful for discovering and comparing active providers
   */
  @Get()
  @ApiOperation({
    summary: "List storage providers",
    description: "Get a paginated list of storage providers with their weekly performance metrics",
  })
  @ApiQuery({ name: "minHealthScore", required: false, type: Number, description: "Minimum health score (0-100)" })
  @ApiQuery({ name: "activeOnly", required: false, type: Boolean, description: "Show only active providers" })
  @ApiQuery({ name: "limit", required: false, type: Number, description: "Number of results per page (default: 20)" })
  @ApiQuery({ name: "offset", required: false, type: Number, description: "Pagination offset (default: 0)" })
  @ApiResponse({ status: 200, description: "List of providers", type: ProviderListResponseDto })
  async listProviders(
    @Query("minHealthScore") minHealthScore?: number,
    @Query("activeOnly") activeOnly?: boolean,
    @Query("limit", new DefaultValuePipe(20), ParseIntPipe) limit?: number,
    @Query("offset", new DefaultValuePipe(0), ParseIntPipe) offset?: number,
  ): Promise<ProviderListResponseDto> {
    this.logger.debug(
      `Listing providers: minHealthScore=${minHealthScore}, activeOnly=${activeOnly}, limit=${limit}, offset=${offset}`,
    );

    const { providers, total } = await this.metricsQueryService.listProvidersWeekly({
      minHealthScore,
      activeOnly: activeOnly === true,
      limit,
      offset,
    });

    // Map entities to DTOs with computed fields
    const providerDtos: ProviderWeeklyPerformanceDto[] = providers.map((p) => ({
      spAddress: p.spAddress,
      totalDeals: p.totalDeals7d,
      successfulDeals: p.successfulDeals7d,
      failedDeals: p.failedDeals7d,
      dealSuccessRate: p.dealSuccessRate7d,
      avgIngestLatencyMs: p.avgIngestLatencyMs7d,
      avgChainLatencyMs: p.avgChainLatencyMs7d,
      avgDealLatencyMs: p.avgDealLatencyMs7d,
      avgIngestThroughputBps: p.avgIngestThroughputBps7d,
      totalDataStoredBytes: p.totalDataStoredBytes7d,
      totalRetrievals: p.totalRetrievals7d,
      successfulRetrievals: p.successfulRetrievals7d,
      failedRetrievals: p.failedRetrievals7d,
      retrievalSuccessRate: p.retrievalSuccessRate7d,
      avgRetrievalLatencyMs: p.avgRetrievalLatencyMs7d,
      avgRetrievalTtfbMs: p.avgRetrievalTtfbMs7d,
      avgRetrievalThroughputBps: p.avgThroughputBps7d,
      totalDataRetrievedBytes: p.totalDataRetrievedBytes7d,
      cdnRetrievals: p.cdnRetrievals7d,
      directRetrievals: p.directRetrievals7d,
      avgCdnLatencyMs: p.avgCdnLatencyMs7d,
      avgDirectLatencyMs: p.avgDirectLatencyMs7d,
      cdnImprovementPercent: p.getCdnImprovementPercent() ?? undefined,
      healthScore: p.getHealthScore(),
      lastDealAt: p.lastDealAt7d,
      lastRetrievalAt: p.lastRetrievalAt7d,
      refreshedAt: p.refreshedAt,
    }));

    return {
      providers: providerDtos,
      total,
      count: providerDtos.length,
      offset: offset || 0,
      limit: limit || 20,
    };
  }

  /**
   * Get detailed performance metrics for a specific storage provider
   * Returns both weekly and all-time metrics
   */
  @Get(":spAddress")
  @ApiOperation({
    summary: "Get provider performance",
    description: "Get detailed weekly and all-time performance metrics for a specific storage provider",
  })
  @ApiParam({ name: "spAddress", description: "Storage provider address" })
  @ApiResponse({ status: 200, description: "Provider performance metrics", type: ProviderCombinedPerformanceDto })
  @ApiResponse({ status: 404, description: "Provider not found" })
  async getProviderPerformance(@Param("spAddress") spAddress: string): Promise<ProviderCombinedPerformanceDto> {
    this.logger.debug(`Getting performance for provider: ${spAddress}`);

    const { weekly, allTime } = await this.metricsQueryService.getCombinedPerformance(spAddress);

    return {
      weekly: {
        spAddress: weekly.spAddress,
        totalDeals: weekly.totalDeals7d,
        successfulDeals: weekly.successfulDeals7d,
        failedDeals: weekly.failedDeals7d,
        dealSuccessRate: weekly.dealSuccessRate7d,
        avgIngestLatencyMs: weekly.avgIngestLatencyMs7d,
        avgChainLatencyMs: weekly.avgChainLatencyMs7d,
        avgDealLatencyMs: weekly.avgDealLatencyMs7d,
        avgIngestThroughputBps: weekly.avgIngestThroughputBps7d,
        totalDataStoredBytes: weekly.totalDataStoredBytes7d,
        totalRetrievals: weekly.totalRetrievals7d,
        successfulRetrievals: weekly.successfulRetrievals7d,
        failedRetrievals: weekly.failedRetrievals7d,
        retrievalSuccessRate: weekly.retrievalSuccessRate7d,
        avgRetrievalLatencyMs: weekly.avgRetrievalLatencyMs7d,
        avgRetrievalTtfbMs: weekly.avgRetrievalTtfbMs7d,
        avgRetrievalThroughputBps: weekly.avgThroughputBps7d,
        totalDataRetrievedBytes: weekly.totalDataRetrievedBytes7d,
        cdnRetrievals: weekly.cdnRetrievals7d,
        directRetrievals: weekly.directRetrievals7d,
        avgCdnLatencyMs: weekly.avgCdnLatencyMs7d,
        avgDirectLatencyMs: weekly.avgDirectLatencyMs7d,
        cdnImprovementPercent: weekly.getCdnImprovementPercent() ?? undefined,
        healthScore: weekly.getHealthScore(),
        lastDealAt: weekly.lastDealAt7d,
        lastRetrievalAt: weekly.lastRetrievalAt7d,
        refreshedAt: weekly.refreshedAt,
      },
      allTime: {
        spAddress: allTime.spAddress,
        totalDeals: allTime.totalDeals,
        successfulDeals: allTime.successfulDeals,
        failedDeals: allTime.failedDeals,
        dealSuccessRate: allTime.dealSuccessRate,
        avgIngestLatencyMs: allTime.avgIngestLatencyMs,
        avgChainLatencyMs: allTime.avgChainLatencyMs,
        avgDealLatencyMs: allTime.avgDealLatencyMs,
        avgIngestThroughputBps: allTime.avgIngestThroughputBps,
        totalDataStoredBytes: allTime.totalDataStoredBytes,
        totalRetrievals: allTime.totalRetrievals,
        successfulRetrievals: allTime.successfulRetrievals,
        failedRetrievals: allTime.failedRetrievals,
        retrievalSuccessRate: allTime.retrievalSuccessRate,
        avgRetrievalLatencyMs: allTime.avgRetrievalLatencyMs,
        avgRetrievalTtfbMs: allTime.avgRetrievalTtfbMs,
        avgRetrievalThroughputBps: allTime.avgThroughputBps,
        totalDataRetrievedBytes: allTime.totalDataRetrievedBytes,
        cdnRetrievals: allTime.cdnRetrievals,
        directRetrievals: allTime.directRetrievals,
        avgCdnLatencyMs: allTime.avgCdnLatencyMs,
        avgDirectLatencyMs: allTime.avgDirectLatencyMs,
        cdnImprovementPercent: allTime.getCdnImprovementPercent() ?? undefined,
        reliabilityScore: allTime.getReliabilityScore(),
        experienceLevel: allTime.getExperienceLevel(),
        avgDealSize: allTime.getAvgDealSize() ?? undefined,
        lastDealAt: allTime.lastDealAt,
        lastRetrievalAt: allTime.lastRetrievalAt,
        refreshedAt: allTime.refreshedAt,
      },
    };
  }

  /**
   * Get top performing providers by specific metric
   */
  @Get("top/:metric")
  @ApiOperation({
    summary: "Get top providers",
    description: "Get top performing providers by a specific metric",
  })
  @ApiParam({
    name: "metric",
    enum: ["deal_success_rate", "retrieval_success_rate", "deal_latency", "retrieval_latency"],
  })
  @ApiQuery({
    name: "period",
    required: false,
    enum: ["weekly", "all_time"],
    description: "Time period (default: weekly)",
  })
  @ApiQuery({ name: "limit", required: false, type: Number, description: "Number of results (default: 10)" })
  @ApiResponse({ status: 200, description: "Top providers", type: [ProviderWeeklyPerformanceDto] })
  async getTopProviders(
    @Param("metric") metric: "deal_success_rate" | "retrieval_success_rate" | "deal_latency" | "retrieval_latency",
    @Query("period") period?: "weekly" | "all_time",
    @Query("limit", new DefaultValuePipe(10), ParseIntPipe) limit?: number,
  ): Promise<ProviderWeeklyPerformanceDto[] | ProviderAllTimePerformanceDto[]> {
    this.logger.debug(`Getting top providers by ${metric} for period ${period || "weekly"}`);

    const providers = await this.metricsQueryService.getTopProviders(metric, {
      period: period || "weekly",
      limit,
    });

    if (period === "all_time") {
      return (providers as any[]).map((p) => this.mapAllTimeToDto(p));
    }

    return (providers as any[]).map((p) => this.mapWeeklyToDto(p));
  }

  /**
   * Get overall network statistics
   */
  @Get("network/stats")
  @ApiOperation({
    summary: "Get network statistics",
    description: "Get aggregated statistics across all storage providers",
  })
  @ApiResponse({ status: 200, description: "Network statistics", type: NetworkStatsDto })
  async getNetworkStats(): Promise<NetworkStatsDto> {
    this.logger.debug("Getting network statistics");

    return await this.metricsQueryService.getNetworkStats();
  }

  /**
   * Helper method to map weekly entity to DTO
   * @private
   */
  private mapWeeklyToDto(weekly: any): ProviderWeeklyPerformanceDto {
    return {
      spAddress: weekly.spAddress,
      totalDeals: weekly.totalDeals7d,
      successfulDeals: weekly.successfulDeals7d,
      failedDeals: weekly.failedDeals7d,
      dealSuccessRate: weekly.dealSuccessRate7d,
      avgIngestLatencyMs: weekly.avgIngestLatencyMs7d,
      avgChainLatencyMs: weekly.avgChainLatencyMs7d,
      avgDealLatencyMs: weekly.avgDealLatencyMs7d,
      avgIngestThroughputBps: weekly.avgIngestThroughputBps7d,
      totalDataStoredBytes: weekly.totalDataStoredBytes7d,
      totalRetrievals: weekly.totalRetrievals7d,
      successfulRetrievals: weekly.successfulRetrievals7d,
      failedRetrievals: weekly.failedRetrievals7d,
      retrievalSuccessRate: weekly.retrievalSuccessRate7d,
      avgRetrievalLatencyMs: weekly.avgRetrievalLatencyMs7d,
      avgRetrievalTtfbMs: weekly.avgRetrievalTtfbMs7d,
      avgRetrievalThroughputBps: weekly.avgThroughputBps7d,
      totalDataRetrievedBytes: weekly.totalDataRetrievedBytes7d,
      cdnRetrievals: weekly.cdnRetrievals7d,
      directRetrievals: weekly.directRetrievals7d,
      avgCdnLatencyMs: weekly.avgCdnLatencyMs7d,
      avgDirectLatencyMs: weekly.avgDirectLatencyMs7d,
      cdnImprovementPercent: weekly.getCdnImprovementPercent?.() ?? undefined,
      healthScore: weekly.getHealthScore?.() || 0,
      lastDealAt: weekly.lastDealAt7d,
      lastRetrievalAt: weekly.lastRetrievalAt7d,
      refreshedAt: weekly.refreshedAt,
    };
  }

  /**
   * Helper method to map all-time entity to DTO
   * @private
   */
  private mapAllTimeToDto(allTime: any): ProviderAllTimePerformanceDto {
    return {
      spAddress: allTime.spAddress,
      totalDeals: allTime.totalDeals,
      successfulDeals: allTime.successfulDeals,
      failedDeals: allTime.failedDeals,
      dealSuccessRate: allTime.dealSuccessRate,
      avgIngestLatencyMs: allTime.avgIngestLatencyMs,
      avgChainLatencyMs: allTime.avgChainLatencyMs,
      avgDealLatencyMs: allTime.avgDealLatencyMs,
      avgIngestThroughputBps: allTime.avgIngestThroughputBps,
      totalDataStoredBytes: allTime.totalDataStoredBytes,
      totalRetrievals: allTime.totalRetrievals,
      successfulRetrievals: allTime.successfulRetrievals,
      failedRetrievals: allTime.failedRetrievals,
      retrievalSuccessRate: allTime.retrievalSuccessRate,
      avgRetrievalLatencyMs: allTime.avgRetrievalLatencyMs,
      avgRetrievalTtfbMs: allTime.avgRetrievalTtfbMs,
      avgRetrievalThroughputBps: allTime.avgThroughputBps,
      totalDataRetrievedBytes: allTime.totalDataRetrievedBytes,
      cdnRetrievals: allTime.cdnRetrievals,
      directRetrievals: allTime.directRetrievals,
      avgCdnLatencyMs: allTime.avgCdnLatencyMs,
      avgDirectLatencyMs: allTime.avgDirectLatencyMs,
      cdnImprovementPercent: allTime.getCdnImprovementPercent?.() ?? undefined,
      reliabilityScore: allTime.getReliabilityScore?.() || 0,
      experienceLevel: allTime.getExperienceLevel?.() || "new",
      avgDealSize: allTime.getAvgDealSize?.() ?? undefined,
      lastDealAt: allTime.lastDealAt,
      lastRetrievalAt: allTime.lastRetrievalAt,
      refreshedAt: allTime.refreshedAt,
    };
  }
}
