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
    description: "Network-wide average deal ingest latency in milliseconds",
    example: 800,
  })
  avgDealIngestLatencyMs: number;

  @ApiProperty({
    description: "Network-wide average deal chain latency in milliseconds",
    example: 450,
  })
  avgDealChainLatencyMs: number;

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
}
