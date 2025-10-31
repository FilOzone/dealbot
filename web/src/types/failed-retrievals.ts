import type { ServiceType } from "./services";

/**
 * Failed retrieval details with error information
 */
export interface FailedRetrieval {
  id: string;
  dealId: string;
  serviceType: ServiceType;
  retrievalEndpoint: string;
  status: string;
  startedAt: Date;
  completedAt?: Date;
  latencyMs?: number;
  throughputBps?: number;
  bytesRetrieved?: number;
  ttfbMs?: number;
  responseCode?: number;
  errorMessage: string;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
  spAddress?: string;
  fileName?: string;
  pieceCid?: string;
}

/**
 * Error summary statistics for retrievals
 */
export interface RetrievalErrorSummary {
  errorMessage: string;
  responseCode?: number;
  count: number;
  percentage: number;
}

/**
 * Service type failure statistics
 */
export interface ServiceTypeFailureStats {
  serviceType: ServiceType;
  failedRetrievals: number;
  percentage: number;
  mostCommonError: string;
}

/**
 * Provider failure statistics for retrievals
 */
export interface ProviderRetrievalFailureStats {
  spAddress: string;
  failedRetrievals: number;
  percentage: number;
  mostCommonError: string;
}

/**
 * Pagination metadata
 */
export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Failed retrievals response with pagination and summary
 */
export interface FailedRetrievalsResponse {
  failedRetrievals: FailedRetrieval[];
  pagination: Pagination;
  dateRange: {
    startDate: string;
    endDate: string;
  };
  summary: {
    totalFailedRetrievals: number;
    uniqueProviders: number;
    uniqueServiceTypes: number;
    mostCommonErrors: RetrievalErrorSummary[];
    failuresByServiceType: ServiceTypeFailureStats[];
    failuresByProvider: ProviderRetrievalFailureStats[];
  };
}

/**
 * Query options for failed retrievals
 */
export interface FailedRetrievalsQueryOptions {
  page?: number;
  limit?: number;
  spAddress?: string;
  serviceType?: string;
  startDate?: string;
  endDate?: string;
}
