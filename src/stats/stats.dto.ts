export interface ProviderPerformanceDto {
  provider: string;
  totalDeals: number;
  totalRetrievals: number;
  ingestLatency: number;
  ingestThroughput: number;
  chainLatency: number;
  dealLatency: number;
  dealSuccessRate: number;
  dealFailureRate: number;
  retrievalSuccessRate: number;
  retrievalFailureRate: number;
  retrievalLatency: number;
  retrievalThroughput: number;
}

export interface OverallStatsDto {
  totalDeals: number;
  totalRetrievals: number;
  totalDealsWithCDN: number;
  totalDealsWithoutCDN: number;
  totalRetrievalsWithCDN: number;
  totalRetrievalsWithoutCDN: number;
  cdnDealsSuccessRate: number;
  directDealsSuccessRate: number;
  cdnRetrievalsSuccessRate: number;
  directRetrievalsSuccessRate: number;
  ingestLatency: number;
  ingestThroughput: number;
  chainLatency: number;
  dealLatency: number;
  retrievalLatency: number;
  retrievalThroughput: number;
  providerPerformance: ProviderPerformanceDto[];
}

export interface OverallStatsResponseDto {
  overallStats: OverallStatsDto;
}

export interface DailyMetricDto {
  date: string; // ISO date string (YYYY-MM-DD)
  dealsWithCDN: number;
  dealsWithoutCDN: number;
  retrievalsWithCDN: number;
  retrievalsWithoutCDN: number;
  dealsSuccessRateWithCDN: number;
  dealsSuccessRateWithoutCDN: number;
  retrievalsSuccessRateWithCDN: number;
  retrievalsSuccessRateWithoutCDN: number;
  avgDealLatencyWithCDN: number;
  avgDealLatencyWithoutCDN: number;
  avgRetrievalLatencyWithCDN: number;
  avgRetrievalLatencyWithoutCDN: number;
  avgIngestLatencyWithCDN: number;
  avgIngestLatencyWithoutCDN: number;
  avgIngestThroughputWithCDN: number;
  avgIngestThroughputWithoutCDN: number;
  avgChainLatencyWithCDN: number;
  avgChainLatencyWithoutCDN: number;
  avgRetrievalThroughputWithCDN: number;
  avgRetrievalThroughputWithoutCDN: number;
  providers: ProviderDailyMetricDto[];
}

export interface DailyMetricsResponseDto {
  dailyMetrics: DailyMetricDto[];
  dateRange: {
    startDate: string;
    endDate: string;
  };
  summary: {
    totalDays: number;
    totalProviders: number;
    totalDeals: number;
    totalRetrievals: number;
  };
}

export interface ProviderDailyMetricDto {
  date: string; // ISO date string (YYYY-MM-DD)
  provider: string;
  dealsWithCDN: number;
  dealsWithoutCDN: number;
  retrievalsWithoutCDN: number;
  dealsSuccessRateWithCDN: number;
  dealsSuccessRateWithoutCDN: number;
  retrievalsSuccessRateWithoutCDN: number;
  avgDealLatencyWithCDN: number;
  avgDealLatencyWithoutCDN: number;
  avgRetrievalLatencyWithoutCDN: number;
  avgIngestLatencyWithCDN: number;
  avgIngestLatencyWithoutCDN: number;
  avgIngestThroughputWithCDN: number;
  avgIngestThroughputWithoutCDN: number;
  avgChainLatencyWithCDN: number;
  avgChainLatencyWithoutCDN: number;
  avgRetrievalThroughputWithoutCDN: number;
}
