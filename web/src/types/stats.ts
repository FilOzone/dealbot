export interface ProviderPerformanceDto {
  provider: string;
  name: string;
  description: string;
  serviceUrl: string;
  payee: string;
  isActive: boolean;
  lastDealTime: Date;
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
  providerName: string;
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

export interface FailedDealDto {
  id: string;
  fileName: string;
  fileSize: number;
  dataSetId: number;
  cid: string;
  dealId: string;
  storageProvider: string;
  providerName: string;
  withCDN: boolean;
  status: string;
  errorMessage: string;
  errorCode: string;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
  uploadStartTime?: Date;
  uploadEndTime?: Date;
  pieceAddedTime?: Date;
  dealConfirmedTime?: Date;
}

export interface FailedDealsResponseDto {
  failedDeals: FailedDealDto[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  summary: {
    totalFailedDeals: number;
    uniqueProviders: number;
    mostCommonErrors: Array<{
      errorCode: string;
      errorMessage: string;
      count: number;
    }>;
    failuresByProvider: Array<{
      provider: string;
      providerName: string;
      failedDeals: number;
      mostCommonError: string;
    }>;
  };
  dateRange: {
    startDate: string;
    endDate: string;
  };
}
