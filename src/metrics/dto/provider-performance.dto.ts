import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * DTO for storage provider weekly performance metrics
 */
export class ProviderWeeklyPerformanceDto {
  @ApiProperty({ description: "Storage provider address" })
  spAddress: string;

  @ApiProperty({ description: "Total deals in last 7 days" })
  totalDeals: number;

  @ApiProperty({ description: "Successful deals in last 7 days" })
  successfulDeals: number;

  @ApiProperty({ description: "Failed deals in last 7 days" })
  failedDeals: number;

  @ApiProperty({ description: "Deal success rate percentage (0-100)" })
  dealSuccessRate: number;

  @ApiProperty({ description: "Average ingest latency in milliseconds" })
  avgIngestLatencyMs: number;

  @ApiProperty({ description: "Average chain latency in milliseconds" })
  avgChainLatencyMs: number;

  @ApiProperty({ description: "Average deal latency in milliseconds" })
  avgDealLatencyMs: number;

  @ApiProperty({ description: "Average ingest throughput in bytes per second" })
  avgIngestThroughputBps: number;

  @ApiProperty({ description: "Total data stored in bytes" })
  totalDataStoredBytes: string;

  @ApiProperty({ description: "Total retrievals in last 7 days" })
  totalRetrievals: number;

  @ApiProperty({ description: "Successful retrievals in last 7 days" })
  successfulRetrievals: number;

  @ApiProperty({ description: "Failed retrievals in last 7 days" })
  failedRetrievals: number;

  @ApiProperty({ description: "Retrieval success rate percentage (0-100)" })
  retrievalSuccessRate: number;

  @ApiProperty({ description: "Average retrieval latency in milliseconds" })
  avgRetrievalLatencyMs: number;

  @ApiProperty({ description: "Average retrieval TTFB in milliseconds" })
  avgRetrievalTtfbMs: number;

  @ApiProperty({ description: "Average retrieval throughput in bytes per second" })
  avgRetrievalThroughputBps: number;

  @ApiProperty({ description: "Total data retrieved in bytes" })
  totalDataRetrievedBytes: string;

  @ApiProperty({ description: "CDN retrievals count" })
  cdnRetrievals: number;

  @ApiProperty({ description: "Direct retrievals count" })
  directRetrievals: number;

  @ApiProperty({ description: "Average CDN latency in milliseconds" })
  avgCdnLatencyMs: number;

  @ApiProperty({ description: "Average direct latency in milliseconds" })
  avgDirectLatencyMs: number;

  @ApiPropertyOptional({ description: "CDN performance improvement percentage" })
  cdnImprovementPercent?: number;

  @ApiProperty({ description: "Health score (0-100)" })
  healthScore: number;

  @ApiProperty({ description: "Last deal timestamp" })
  lastDealAt: Date;

  @ApiProperty({ description: "Last retrieval timestamp" })
  lastRetrievalAt: Date;

  @ApiProperty({ description: "Data last refreshed at" })
  refreshedAt: Date;
}

/**
 * DTO for storage provider all-time performance metrics
 */
export class ProviderAllTimePerformanceDto {
  @ApiProperty({ description: "Storage provider address" })
  spAddress: string;

  @ApiProperty({ description: "Total deals (all time)" })
  totalDeals: number;

  @ApiProperty({ description: "Successful deals (all time)" })
  successfulDeals: number;

  @ApiProperty({ description: "Failed deals (all time)" })
  failedDeals: number;

  @ApiProperty({ description: "Deal success rate percentage (0-100)" })
  dealSuccessRate: number;

  @ApiProperty({ description: "Average ingest latency in milliseconds" })
  avgIngestLatencyMs: number;

  @ApiProperty({ description: "Average chain latency in milliseconds" })
  avgChainLatencyMs: number;

  @ApiProperty({ description: "Average deal latency in milliseconds" })
  avgDealLatencyMs: number;

  @ApiProperty({ description: "Average ingest throughput in bytes per second" })
  avgIngestThroughputBps: number;

  @ApiProperty({ description: "Total data stored in bytes" })
  totalDataStoredBytes: string;

  @ApiProperty({ description: "Total retrievals (all time)" })
  totalRetrievals: number;

  @ApiProperty({ description: "Successful retrievals (all time)" })
  successfulRetrievals: number;

  @ApiProperty({ description: "Failed retrievals (all time)" })
  failedRetrievals: number;

  @ApiProperty({ description: "Retrieval success rate percentage (0-100)" })
  retrievalSuccessRate: number;

  @ApiProperty({ description: "Average retrieval latency in milliseconds" })
  avgRetrievalLatencyMs: number;

  @ApiProperty({ description: "Average retrieval TTFB in milliseconds" })
  avgRetrievalTtfbMs: number;

  @ApiProperty({ description: "Average retrieval throughput in bytes per second" })
  avgRetrievalThroughputBps: number;

  @ApiProperty({ description: "Total data retrieved in bytes" })
  totalDataRetrievedBytes: string;

  @ApiProperty({ description: "CDN retrievals count" })
  cdnRetrievals: number;

  @ApiProperty({ description: "Direct retrievals count" })
  directRetrievals: number;

  @ApiProperty({ description: "Average CDN latency in milliseconds" })
  avgCdnLatencyMs: number;

  @ApiProperty({ description: "Average direct latency in milliseconds" })
  avgDirectLatencyMs: number;

  @ApiPropertyOptional({ description: "CDN performance improvement percentage" })
  cdnImprovementPercent?: number;

  @ApiPropertyOptional({ description: "Reliability score (0-100)" })
  reliabilityScore?: number;

  @ApiPropertyOptional({ description: "Experience level", enum: ["new", "intermediate", "experienced", "veteran"] })
  experienceLevel?: string;

  @ApiPropertyOptional({ description: "Average deal size in bytes" })
  avgDealSize?: number;

  @ApiProperty({ description: "Last deal timestamp" })
  lastDealAt: Date;

  @ApiProperty({ description: "Last retrieval timestamp" })
  lastRetrievalAt: Date;

  @ApiProperty({ description: "Data last refreshed at" })
  refreshedAt: Date;
}

/**
 * DTO for combined provider performance
 */
export class ProviderCombinedPerformanceDto {
  @ApiProperty({ type: ProviderWeeklyPerformanceDto })
  weekly: ProviderWeeklyPerformanceDto;

  @ApiProperty({ type: ProviderAllTimePerformanceDto })
  allTime: ProviderAllTimePerformanceDto;
}

/**
 * DTO for provider list response
 */
export class ProviderListResponseDto {
  @ApiProperty({ type: [ProviderWeeklyPerformanceDto] })
  providers: ProviderWeeklyPerformanceDto[];

  @ApiProperty({ description: "Total number of providers" })
  total: number;

  @ApiProperty({ description: "Number of providers returned" })
  count: number;

  @ApiProperty({ description: "Pagination offset" })
  offset: number;

  @ApiProperty({ description: "Pagination limit" })
  limit: number;
}

/**
 * DTO for network statistics
 */
export class NetworkStatsDto {
  @ApiProperty({ description: "Total number of storage providers" })
  totalProviders: number;

  @ApiProperty({ description: "Number of active providers" })
  activeProviders: number;

  @ApiProperty({ description: "Total deals across all providers" })
  totalDeals: number;

  @ApiProperty({ description: "Total retrievals across all providers" })
  totalRetrievals: number;

  @ApiProperty({ description: "Average deal success rate percentage" })
  avgDealSuccessRate: number;

  @ApiProperty({ description: "Average retrieval success rate percentage" })
  avgRetrievalSuccessRate: number;

  @ApiProperty({ description: "Total data stored in bytes" })
  totalDataStored: string;

  @ApiProperty({ description: "Total data retrieved in bytes" })
  totalDataRetrieved: string;
}
