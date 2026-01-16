import { ApiProperty } from "@nestjs/swagger";

/**
 * Overall network statistics aggregated across all providers
 */
export class NetworkOverallStatsDto {
  @ApiProperty({
    description: "Total number of storage providers",
    example: 15,
  })
  totalProviders: number;

  @ApiProperty({
    description: "Number of FWSS approved storage providers",
    example: 12,
  })
  approvedProviders: number;

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
    description: "Network-wide average ingest latency in milliseconds",
    example: 800,
  })
  avgIngestLatencyMs: number;

  @ApiProperty({
    description: "Network-wide average deal chain latency in milliseconds",
    example: 450,
  })
  avgChainLatencyMs: number;

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
    description: "Network-wide average retrieval throughput in bytes per second",
    example: 12,
  })
  avgRetrievalThroughputBps: number;

  @ApiProperty({
    description: "Network-wide average ingest throughput in bytes per second",
    example: 12,
  })
  avgIngestThroughputBps: number;

  @ApiProperty({
    description: "Timestamp of last data refresh",
    example: "2024-01-15T10:30:00.000Z",
  })
  lastRefreshedAt: Date;
}
