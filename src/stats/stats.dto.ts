export interface ProviderPerformanceDto {
  provider: string;
  totalDeals: number;
  totalRetrievals: number;
  ingestLatency: number;
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
  chainLatency: number;
  dealLatency: number;
  retrievalLatency: number;
  retrievalThroughput: number;
  providerPerformance: ProviderPerformanceDto[];
}

export interface OverallStatsResponseDto {
  overallStats: OverallStatsDto;
}
