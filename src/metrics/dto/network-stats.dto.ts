import { ApiProperty } from "@nestjs/swagger";

/**
 * Overall network statistics aggregated across all providers
 */
export class NetworkOverallStatsDto {
  @ApiProperty({
    description: "Total number of active storage providers",
    example: 15,
  })
  totalProviders: number;

  @ApiProperty({
    description: "Number of providers with recent activity (last 7 days)",
    example: 12,
  })
  activeProviders: number;

  @ApiProperty({
    description: "Total number of deals across all providers",
    example: 50000,
  })
  totalDeals: number;

  @ApiProperty({
    description: "Total number of successful deals",
    example: 47500,
  })
  successfulDeals: number;

  @ApiProperty({
    description: "Overall deal success rate percentage",
    example: 95.0,
  })
  dealSuccessRate: number;

  @ApiProperty({
    description: "Total number of retrievals across all providers",
    example: 125000,
  })
  totalRetrievals: number;

  @ApiProperty({
    description: "Total number of successful retrievals",
    example: 123750,
  })
  successfulRetrievals: number;

  @ApiProperty({
    description: "Overall retrieval success rate percentage",
    example: 99.0,
  })
  retrievalSuccessRate: number;

  @ApiProperty({
    description: "Total data stored across all providers in bytes",
    example: "10995116277760",
  })
  totalDataStoredBytes: string;

  @ApiProperty({
    description: "Total data retrieved across all providers in bytes",
    example: "27487790694400",
  })
  totalDataRetrievedBytes: string;

  @ApiProperty({
    description: "Network-wide average deal latency in milliseconds",
    example: 1250,
  })
  avgDealLatencyMs: number;

  @ApiProperty({
    description: "Network-wide average retrieval latency in milliseconds",
    example: 450,
  })
  avgRetrievalLatencyMs: number;

  @ApiProperty({
    description: "Network-wide average retrieval TTFB in milliseconds",
    example: 120,
  })
  avgRetrievalTtfbMs: number;

  @ApiProperty({
    description: "Total CDN retrievals",
    example: 75000,
  })
  totalCdnRetrievals: number;

  @ApiProperty({
    description: "Total direct retrievals",
    example: 50000,
  })
  totalDirectRetrievals: number;

  @ApiProperty({
    description: "CDN usage percentage",
    example: 60.0,
  })
  cdnUsagePercentage: number;

  @ApiProperty({
    description: "Average CDN latency in milliseconds",
    example: 380,
    nullable: true,
  })
  avgCdnLatencyMs?: number;

  @ApiProperty({
    description: "Average direct latency in milliseconds",
    example: 550,
    nullable: true,
  })
  avgDirectLatencyMs?: number;

  @ApiProperty({
    description: "CDN performance improvement percentage over direct",
    example: 30.9,
    nullable: true,
  })
  cdnImprovementPercent?: number;

  @ApiProperty({
    description: "Timestamp of last data refresh",
    example: "2024-01-15T10:30:00.000Z",
  })
  lastRefreshedAt: Date;
}

/**
 * Network health indicators
 */
export class NetworkHealthDto {
  @ApiProperty({
    description: "Overall network health score (0-100)",
    example: 95.5,
  })
  healthScore: number;

  @ApiProperty({
    description: "Deal reliability score (0-100)",
    example: 94.8,
  })
  dealReliability: number;

  @ApiProperty({
    description: "Retrieval reliability score (0-100)",
    example: 98.5,
  })
  retrievalReliability: number;

  @ApiProperty({
    description: "Performance score based on latencies (0-100)",
    example: 92.3,
  })
  performanceScore: number;

  @ApiProperty({
    description: "Provider diversity score (0-100)",
    example: 88.0,
  })
  diversityScore: number;
}

/**
 * Network activity trends
 */
export class NetworkTrendsDto {
  @ApiProperty({
    description: "Deal volume trend (last 7 days vs previous 7 days)",
    example: 15.5,
  })
  dealVolumeTrend: number;

  @ApiProperty({
    description: "Retrieval volume trend (last 7 days vs previous 7 days)",
    example: 22.3,
  })
  retrievalVolumeTrend: number;

  @ApiProperty({
    description: "Success rate trend (last 7 days vs previous 7 days)",
    example: 2.1,
  })
  successRateTrend: number;

  @ApiProperty({
    description: "Active providers trend (last 7 days vs previous 7 days)",
    example: 8.3,
  })
  activeProvidersTrend: number;
}

/**
 * Complete network statistics response
 */
export class NetworkStatsResponseDto {
  @ApiProperty({
    description: "Overall network statistics",
    type: NetworkOverallStatsDto,
  })
  overall: NetworkOverallStatsDto;

  @ApiProperty({
    description: "Network health indicators",
    type: NetworkHealthDto,
  })
  health: NetworkHealthDto;

  @ApiProperty({
    description: "Network activity trends",
    type: NetworkTrendsDto,
  })
  trends: NetworkTrendsDto;
}
