import { ApiProperty } from "@nestjs/swagger";

/**
 * Daily aggregated metrics for a specific date
 * Provides time-series data for visualization
 */
export class DailyAggregatedMetricsDto {
  @ApiProperty({
    description: "Date in ISO format (YYYY-MM-DD)",
    example: "2024-01-15",
  })
  date: string;

  @ApiProperty({
    description: "Total number of deals on this date",
    example: 150,
  })
  totalDeals: number;

  @ApiProperty({
    description: "Number of successful deals",
    example: 142,
  })
  successfulDeals: number;

  @ApiProperty({
    description: "Deal success rate percentage",
    example: 94.67,
  })
  dealSuccessRate: number;

  @ApiProperty({
    description: "Total number of retrievals on this date",
    example: 320,
  })
  totalRetrievals: number;

  @ApiProperty({
    description: "Number of successful retrievals",
    example: 315,
  })
  successfulRetrievals: number;

  @ApiProperty({
    description: "Retrieval success rate percentage",
    example: 98.44,
  })
  retrievalSuccessRate: number;

  @ApiProperty({
    description: "Average deal latency in milliseconds",
    example: 1250,
  })
  avgDealLatencyMs: number;

  @ApiProperty({
    description: "Average ingest latency in milliseconds",
    example: 1250,
    nullable: true,
  })
  avgIngestLatencyMs: number;

  @ApiProperty({
    description: "Average retrieval latency in milliseconds",
    example: 450,
  })
  avgRetrievalLatencyMs: number;

  @ApiProperty({
    description: "Average retrieval TTFB in milliseconds",
    example: 120,
  })
  avgRetrievalTtfbMs: number;

  @ApiProperty({
    description: "Average retrieval throughput in bytes per second",
    example: 1000000,
  })
  avgRetrievalThroughputBps: number;

  @ApiProperty({
    description: "Average ingest throughput in bytes per second",
    example: 1000000,
    nullable: true,
  })
  avgIngestThroughputBps: number;

  @ApiProperty({
    description: "Total data stored in bytes",
    example: "1073741824",
  })
  totalDataStoredBytes: string;

  @ApiProperty({
    description: "Total data retrieved in bytes",
    example: "2147483648",
  })
  totalDataRetrievedBytes: string;

  @ApiProperty({
    description: "Number of unique providers active on this date",
    example: 12,
  })
  uniqueProviders: number;
}

/**
 * Service metrics for a specific service type
 */
export interface ServiceMetrics {
  totalRetrievals: number;
  successfulRetrievals: number;
  successRate: number;
  avgLatencyMs: number;
  avgTtfbMs: number;
  avgThroughputBps: number;
  totalDataRetrievedBytes: string;
}

/**
 * Service type comparison metrics for a specific date
 * Breaks down retrieval metrics by service type (CDN, DIRECT_SP, IPFS_PIN)
 */
export class ServiceComparisonMetricsDto {
  @ApiProperty({
    description: "Date in ISO format (YYYY-MM-DD)",
    example: "2024-01-15",
  })
  date: string;

  @ApiProperty({
    description: "CDN retrieval metrics",
    example: {
      totalRetrievals: 100,
      successfulRetrievals: 98,
      successRate: 98.0,
      avgLatencyMs: 350,
      avgTtfbMs: 120,
      totalDataRetrievedBytes: "1073741824",
    },
  })
  cdn: ServiceMetrics;

  @ApiProperty({
    description: "Direct SP retrieval metrics",
    example: {
      totalRetrievals: 150,
      successfulRetrievals: 145,
      successRate: 96.67,
      avgLatencyMs: 520,
      avgTtfbMs: 180,
      totalDataRetrievedBytes: "2147483648",
    },
  })
  directSp: ServiceMetrics;

  @ApiProperty({
    description: "IPFS Pin retrieval metrics",
    example: {
      totalRetrievals: 50,
      successfulRetrievals: 48,
      successRate: 96.0,
      avgLatencyMs: 450,
      avgTtfbMs: 150,
      totalDataRetrievedBytes: "536870912",
    },
  })
  ipfsPin: ServiceMetrics;
}

/**
 * Response DTO for service comparison endpoint
 */
export class ServiceComparisonResponseDto {
  @ApiProperty({
    description: "Daily service comparison metrics",
    type: [ServiceComparisonMetricsDto],
  })
  dailyMetrics: ServiceComparisonMetricsDto[];

  @ApiProperty({
    description: "Date range for the query",
    example: { startDate: "2024-01-01", endDate: "2024-01-31" },
  })
  dateRange: {
    startDate: string;
    endDate: string;
  };

  @ApiProperty({
    description: "Summary statistics across all days",
    example: {
      totalDays: 30,
      cdnTotalRetrievals: 3000,
      directSpTotalRetrievals: 4500,
      ipfsPinTotalRetrievals: 1500,
      cdnAvgSuccessRate: 98.2,
      directSpAvgSuccessRate: 96.5,
      ipfsPinAvgSuccessRate: 95.8,
    },
  })
  summary: {
    totalDays: number;
    cdnTotalRetrievals: number;
    directSpTotalRetrievals: number;
    ipfsPinTotalRetrievals: number;
    cdnAvgSuccessRate: number;
    directSpAvgSuccessRate: number;
    ipfsPinAvgSuccessRate: number;
  };
}

/**
 * Provider-specific metrics for a single day
 */
export class ProviderDailyMetricsDto {
  @ApiProperty({
    description: "Date in ISO format (YYYY-MM-DD)",
    example: "2024-01-15",
  })
  date: string;

  @ApiProperty({
    description: "Storage provider address",
    example: "0x1234567890abcdef",
  })
  spAddress: string;

  @ApiProperty({
    description: "Total deals for this provider on this date",
    example: 25,
  })
  totalDeals: number;

  @ApiProperty({
    description: "Successful deals",
    example: 24,
  })
  successfulDeals: number;

  @ApiProperty({
    description: "Deal success rate percentage",
    example: 96.0,
  })
  dealSuccessRate: number;

  @ApiProperty({
    description: "Total retrievals",
    example: 45,
  })
  totalRetrievals: number;

  @ApiProperty({
    description: "Successful retrievals",
    example: 44,
  })
  successfulRetrievals: number;

  @ApiProperty({
    description: "Retrieval success rate percentage",
    example: 97.78,
  })
  retrievalSuccessRate: number;

  @ApiProperty({
    description: "Average deal latency in milliseconds",
    example: 1180,
  })
  avgDealLatencyMs: number;

  @ApiProperty({
    description: "Average ingest latency in milliseconds",
    example: 1200,
    nullable: true,
  })
  avgIngestLatencyMs?: number;

  @ApiProperty({
    description: "Average retrieval latency in milliseconds",
    example: 420,
  })
  avgRetrievalLatencyMs: number;

  @ApiProperty({
    description: "Average retrieval TTFB in milliseconds",
    example: 120,
    nullable: true,
  })
  avgRetrievalTtfbMs?: number;

  @ApiProperty({
    description: "Average ingest throughput in bytes per second",
    example: 1000000,
    nullable: true,
  })
  avgIngestThroughputBps?: number;

  @ApiProperty({
    description: "Average retrieval throughput in bytes per second",
    example: 1000000,
  })
  avgRetrievalThroughputBps: number;
}

/**
 * Response for daily metrics endpoint
 */
export class DailyMetricsResponseDto {
  @ApiProperty({
    description: "Array of daily aggregated metrics",
    type: [DailyAggregatedMetricsDto],
  })
  dailyMetrics: DailyAggregatedMetricsDto[];

  @ApiProperty({
    description: "Date range for the query",
    example: {
      startDate: "2024-01-01",
      endDate: "2024-01-31",
    },
  })
  dateRange: {
    startDate: string;
    endDate: string;
  };

  @ApiProperty({
    description: "Summary statistics for the entire period",
    example: {
      totalDays: 31,
      totalProviders: 15,
      totalDeals: 4650,
      totalRetrievals: 9920,
      avgDealSuccessRate: 95.2,
      avgRetrievalSuccessRate: 98.1,
    },
  })
  summary: {
    totalDays: number;
    totalProviders: number;
    totalDeals: number;
    totalRetrievals: number;
    avgDealSuccessRate: number;
    avgRetrievalSuccessRate: number;
  };
}

/**
 * Response for provider-specific daily metrics
 */
export class ProviderDailyMetricsResponseDto {
  @ApiProperty({
    description: "Storage provider address",
    example: "0x1234567890abcdef",
  })
  spAddress: string;

  @ApiProperty({
    description: "Array of daily metrics for this provider",
    type: [ProviderDailyMetricsDto],
  })
  dailyMetrics: ProviderDailyMetricsDto[];

  @ApiProperty({
    description: "Date range for the query",
    example: {
      startDate: "2024-01-01",
      endDate: "2024-01-31",
    },
  })
  dateRange: {
    startDate: string;
    endDate: string;
  };

  @ApiProperty({
    description: "Summary statistics for this provider",
    example: {
      totalDays: 31,
      totalDeals: 775,
      totalRetrievals: 1653,
      avgDealSuccessRate: 96.5,
      avgRetrievalSuccessRate: 98.8,
    },
  })
  summary: {
    totalDays: number;
    totalDeals: number;
    totalRetrievals: number;
    avgDealSuccessRate: number;
    avgRetrievalSuccessRate: number;
  };
}
