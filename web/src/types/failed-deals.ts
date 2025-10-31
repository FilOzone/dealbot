/**
 * Failed deal details with error information
 */
export interface FailedDeal {
  id: string;
  fileName: string;
  fileSize: number;
  dataSetId?: number;
  pieceCid?: string;
  spAddress: string;
  status: string;
  errorMessage: string;
  errorCode?: string;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
  uploadStartTime?: Date;
  uploadEndTime?: Date;
  pieceAddedTime?: Date;
  dealConfirmedTime?: Date;
}

/**
 * Error summary statistics
 */
export interface ErrorSummary {
  errorCode: string;
  errorMessage: string;
  count: number;
  percentage: number;
}

/**
 * Provider failure statistics
 */
export interface ProviderFailureStats {
  spAddress: string;
  failedDeals: number;
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
 * Failed deals response with pagination and summary
 */
export interface FailedDealsResponse {
  failedDeals: FailedDeal[];
  pagination: Pagination;
  dateRange: {
    startDate: string;
    endDate: string;
  };
  summary: {
    totalFailedDeals: number;
    uniqueProviders: number;
    mostCommonErrors: ErrorSummary[];
    failuresByProvider: ProviderFailureStats[];
  };
}

/**
 * Query options for failed deals
 */
export interface FailedDealsQueryOptions {
  page?: number;
  limit?: number;
  spAddress?: string;
  startDate?: string;
  endDate?: string;
}
