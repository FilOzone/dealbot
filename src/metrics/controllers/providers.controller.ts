import {
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  Logger,
  Param,
  ParseIntPipe,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { SpPerformanceAllTime } from "src/database/entities/sp-performance-all-time.entity.js";
import { SpPerformanceLastWeek } from "src/database/entities/sp-performance-last-week.entity.js";
import {
  type ProviderAllTimePerformanceDto,
  ProviderCombinedPerformanceDto,
  ProviderListResponseDto,
  ProviderMetricsListResponseDto,
  ProviderWeeklyPerformanceDto,
} from "../dto/provider-performance.dto.js";
import { ProvidersService } from "../services/providers.service.js";

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
export class ProvidersController {
  private readonly logger = new Logger(ProvidersController.name);

  constructor(private readonly providersService: ProvidersService) {}

  /**
   * List all sps with their details
   */
  @Get()
  @ApiOperation({
    summary: "List storage providers",
    description: "Get a paginated list of storage providers with combined weekly and all-time performance metrics",
  })
  @ApiQuery({ name: "limit", required: false, type: Number, description: "Number of results per page (default: 20)" })
  @ApiQuery({ name: "offset", required: false, type: Number, description: "Pagination offset (default: 0)" })
  @ApiResponse({ status: 200, description: "List of providers with combined metrics", type: ProviderListResponseDto })
  async listProviders(
    @Query("limit", new DefaultValuePipe(20), ParseIntPipe) limit?: number,
    @Query("offset", new DefaultValuePipe(0), ParseIntPipe) offset?: number,
  ): Promise<ProviderListResponseDto> {
    this.logger.debug(`Listing providers: limit=${limit}, offset=${offset}`);

    const { providers, total } = await this.providersService.getProvidersList({ limit, offset });

    return {
      providers,
      total,
      count: providers.length,
      offset: offset || 0,
      limit: limit || 20,
    };
  }

  /**
   * List all storage providers with their weekly performance metrics
   * Useful for discovering and comparing active providers
   */
  @Get("metrics")
  @ApiOperation({
    summary: "List storage providers",
    description: "Get a paginated list of storage providers with combined weekly and all-time performance metrics",
  })
  @ApiQuery({ name: "activeOnly", required: false, type: Boolean, description: "Show only active providers" })
  @ApiQuery({ name: "approvedOnly", required: false, type: Boolean, description: "Show only approved providers" })
  @ApiQuery({ name: "limit", required: false, type: Number, description: "Number of results per page (default: 10)" })
  @ApiQuery({ name: "offset", required: false, type: Number, description: "Pagination offset (default: 0)" })
  @ApiResponse({ status: 200, description: "List of providers with combined metrics", type: ProviderListResponseDto })
  async listProvidersWithMetrics(
    @Query("activeOnly") activeOnly?: string,
    @Query("approvedOnly") approvedOnly?: string,
    @Query("limit", new DefaultValuePipe(10), ParseIntPipe) limit?: number,
    @Query("offset", new DefaultValuePipe(0), ParseIntPipe) offset?: number,
  ): Promise<ProviderMetricsListResponseDto> {
    this.logger.debug(
      `Listing providers: activeOnly=${activeOnly}, approvedOnly=${approvedOnly}, limit=${limit}, offset=${offset}`,
    );

    const { providers, total } = await this.providersService.getProvidersList({
      activeOnly: activeOnly === "true",
      approvedOnly: approvedOnly === "true",
      limit,
      offset,
    });

    // Fetch combined performance (weekly + all-time) for each provider
    const providerDtos: ProviderCombinedPerformanceDto[] = await Promise.all(
      providers.map(async (p) => {
        const { weekly, allTime } = await this.providersService.getCombinedPerformance(p.address);

        return {
          provider: p,
          weekly: weekly ? this.mapWeeklyToDto(weekly) : null,
          allTime: allTime ? this.mapAllTimeToDto(allTime) : null,
        };
      }),
    );

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
  @Get("metrics/:spAddress")
  @ApiOperation({
    summary: "Get provider performance",
    description: "Get detailed weekly and all-time performance metrics for a specific storage provider",
  })
  @ApiParam({ name: "spAddress", description: "Storage provider address" })
  @ApiResponse({ status: 200, description: "Provider performance metrics", type: ProviderCombinedPerformanceDto })
  @ApiResponse({ status: 404, description: "Provider not found" })
  async getProviderPerformance(@Param("spAddress") spAddress: string): Promise<ProviderCombinedPerformanceDto> {
    this.logger.debug(`Getting performance for provider: ${spAddress}`);

    const [provider, { weekly, allTime }] = await Promise.all([
      this.providersService.getProvider(spAddress),
      this.providersService.getCombinedPerformance(spAddress),
    ]);

    return {
      provider,
      weekly: weekly ? this.mapWeeklyToDto(weekly) : null,
      allTime: allTime ? this.mapAllTimeToDto(allTime) : null,
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
    enum: ["last_week", "all_time"],
    description: "Time period (default: last_week)",
  })
  @ApiQuery({ name: "limit", required: false, type: Number, description: "Number of results (default: 10)" })
  @ApiResponse({ status: 200, description: "Top providers", type: [ProviderWeeklyPerformanceDto] })
  async getTopProviders(
    @Param("metric") metric: "deal_success_rate" | "retrieval_success_rate" | "deal_latency" | "retrieval_latency",
    @Query("period") period?: "last_week" | "all_time",
    @Query("limit", new DefaultValuePipe(10), ParseIntPipe) limit?: number,
  ): Promise<ProviderWeeklyPerformanceDto[] | ProviderAllTimePerformanceDto[]> {
    this.logger.debug(`Getting top providers by ${metric} for period ${period || "weekly"}`);

    const providers = await this.providersService.getTopProviders(metric, {
      period: period || "last_week",
      limit,
    });

    if (period === "all_time") {
      return (providers as any[]).map((p) => this.mapAllTimeToDto(p));
    }

    return (providers as any[]).map((p) => this.mapWeeklyToDto(p));
  }

  /**
   * Get Curio versions for multiple storage providers in batch
   */
  @Get("versions/batch")
  @ApiOperation({
    summary: "Get Curio versions for multiple providers (batch)",
    description: "Fetch Curio versions for multiple storage providers in a single request",
  })
  @ApiQuery({
    name: "addresses",
    required: true,
    description: "Comma-separated list of storage provider addresses",
    example: "f01234,f05678,f09012",
  })
  @ApiResponse({
    status: 200,
    description: "Map of provider addresses to their Curio versions",
    schema: {
      type: "object",
      additionalProperties: { type: "string" },
      example: {
        f01234: "1.27.0 (76330a87)",
        f05678: "1.26.5 (abc12345)",
      },
    },
  })
  @ApiResponse({ status: 400, description: "Invalid or empty addresses parameter" })
  async getProviderVersionsBatch(@Query("addresses") addresses: string): Promise<Record<string, string>> {
    if (!addresses || addresses.trim() === "") {
      throw new BadRequestException("Addresses parameter is required and cannot be empty");
    }

    const addressList = addresses
      .split(",")
      .map((addr) => addr.trim())
      .filter(Boolean);

    if (addressList.length === 0) {
      throw new BadRequestException("At least one valid provider address is required");
    }

    this.logger.debug(`Fetching Curio versions for ${addressList.length} providers (batch)`);

    return this.providersService.getProviderCurioVersionsBatch(addressList);
  }

  /**
   * Get Curio version from a storage provider's service URL
   */
  @Get(":spAddress/version")
  @ApiOperation({
    summary: "Get provider Curio version",
    description: "Fetch the Curio version from a storage provider's service endpoint (proxied through backend)",
  })
  @ApiParam({ name: "spAddress", description: "Storage provider address" })
  @ApiResponse({ status: 200, description: "Curio version string", type: String })
  @ApiResponse({ status: 404, description: "Provider not found or version endpoint unavailable" })
  async getProviderVersion(@Param("spAddress") spAddress: string): Promise<string> {
    this.logger.debug(`Fetching Curio version for provider: ${spAddress}`);
    return this.providersService.getProviderCurioVersion(spAddress);
  }

  /**
   * Helper method to map weekly entity to DTO
   * @private
   */
  private mapWeeklyToDto(weekly: SpPerformanceLastWeek): ProviderWeeklyPerformanceDto {
    return {
      spAddress: weekly.spAddress,
      totalDeals: weekly.totalDeals,
      successfulDeals: weekly.successfulDeals,
      failedDeals: weekly.failedDeals,
      dealSuccessRate: weekly.dealSuccessRate,
      avgIngestLatencyMs: weekly.avgIngestLatencyMs,
      avgChainLatencyMs: weekly.avgChainLatencyMs,
      avgDealLatencyMs: weekly.avgDealLatencyMs,
      avgIngestThroughputBps: weekly.avgIngestThroughputBps,
      totalDataStoredBytes: weekly.totalDataStoredBytes,
      totalRetrievals: weekly.totalRetrievals,
      successfulRetrievals: weekly.successfulRetrievals,
      failedRetrievals: weekly.failedRetrievals,
      retrievalSuccessRate: weekly.retrievalSuccessRate,
      avgRetrievalLatencyMs: weekly.avgRetrievalLatencyMs,
      avgRetrievalTtfbMs: weekly.avgRetrievalTtfbMs,
      avgRetrievalThroughputBps: weekly.avgThroughputBps,
      totalDataRetrievedBytes: weekly.totalDataRetrievedBytes,
      healthScore: weekly.getHealthScore?.() || 0,
      lastDealAt: weekly.lastDealAt,
      lastRetrievalAt: weekly.lastRetrievalAt,
      refreshedAt: weekly.refreshedAt,
    };
  }

  /**
   * Helper method to map all-time entity to DTO
   * @private
   */
  private mapAllTimeToDto(allTime: SpPerformanceAllTime): ProviderAllTimePerformanceDto {
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
      reliabilityScore: allTime.getReliabilityScore?.() || 0,
      experienceLevel: allTime.getExperienceLevel?.() || "new",
      avgDealSize: allTime.getAvgDealSize?.() ?? undefined,
      lastDealAt: allTime.lastDealAt,
      lastRetrievalAt: allTime.lastRetrievalAt,
      refreshedAt: allTime.refreshedAt,
    };
  }
}
