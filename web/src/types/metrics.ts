/**
 * Daily metrics type definitions
 * Maps to /api/v1/metrics/daily/* endpoints
 */

/**
 * Daily aggregated metrics for a specific date
 * Aggregates across all providers and service types
 */
export interface DailyAggregatedMetrics {
  date: string; // ISO date string (YYYY-MM-DD)
  totalDeals: number;
  successfulDeals: number;
  dealSuccessRate: number;
  totalRetrievals: number;
  successfulRetrievals: number;
  retrievalSuccessRate: number;
  avgDealLatencyMs: number;
  avgIngestLatencyMs: number;
  avgRetrievalLatencyMs: number;
  avgRetrievalTtfbMs: number;
  avgRetrievalThroughputBps: number;
  avgIngestThroughputBps: number;
  totalDataStoredBytes: string; // BigInt as string
  totalDataRetrievedBytes: string; // BigInt as string
  uniqueProviders: number;
}

/**
 * Daily metrics response with date range and summary
 */
export interface DailyMetricsResponse {
  dailyMetrics: DailyAggregatedMetrics[];
  dateRange: {
    startDate: string; // YYYY-MM-DD
    endDate: string; // YYYY-MM-DD
  };
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
 * Provider-specific daily metrics for a single day
 */
export interface ProviderDailyMetrics {
  date: string; // ISO date string (YYYY-MM-DD)
  spAddress: string;
  totalDeals: number;
  successfulDeals: number;
  dealSuccessRate: number;
  totalRetrievals: number;
  successfulRetrievals: number;
  retrievalSuccessRate: number;
  avgDealLatencyMs: number;
  avgRetrievalLatencyMs: number;
  avgRetrievalTtfbMs: number;
  totalDataStoredBytes: string; // BigInt as string
  totalDataRetrievedBytes: string; // BigInt as string
}

/**
 * Provider daily metrics response
 */
export interface ProviderDailyMetricsResponse {
  spAddress: string;
  dailyMetrics: ProviderDailyMetrics[];
  dateRange: {
    startDate: string;
    endDate: string;
  };
  summary: {
    totalDays: number;
    totalDeals: number;
    totalRetrievals: number;
    avgDealSuccessRate: number;
    avgRetrievalSuccessRate: number;
  };
}

/**
 * Query options for daily metrics
 */
export interface DailyMetricsQueryOptions {
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  days?: number; // Alternative to date range
}
