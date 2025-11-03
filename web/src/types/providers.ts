/**
 * Provider performance type definitions
 * Maps to the refactored API endpoints for provider data
 */

/**
 * Decoded provider info
 */
export interface ServiceProduct {
  type: "PDP";
  isActive: boolean;
  capabilities: Record<string, string>; // Object map of capability key-value pairs
  data: PDPOffering;
}

/**
 * PDP offering details (decoded from capability k/v pairs)
 */
export interface PDPOffering {
  serviceURL: string;
  minPieceSizeInBytes: bigint;
  maxPieceSizeInBytes: bigint;
  ipniPiece: boolean;
  ipniIpfs: boolean;
  storagePricePerTibPerDay: bigint;
  minProvingPeriodInEpochs: bigint;
  location: string;
  paymentTokenAddress: `0x${string}`;
}

/**
 * Provider Details
 */
export interface Provider {
  address: string;
  providerId: number;
  name: string;
  description: string;
  payee: string;
  serviceUrl: string;
  isActive: boolean;
  isApproved: boolean;
  region: string;
  metadata?: ServiceProduct | {};
  createdAt: string;
  updatedAt: string;
}

/**
 * Provider performance metrics (unified for weekly/all-time/window)
 */
export interface ProviderPerformanceDto {
  spAddress: string;
  totalDeals: number;
  successfulDeals: number;
  failedDeals: number;
  dealSuccessRate: number;
  avgIngestLatencyMs: number;
  avgChainLatencyMs: number;
  avgDealLatencyMs: number;
  avgIngestThroughputBps: number;
  totalDataStoredBytes: string;
  totalRetrievals: number;
  successfulRetrievals: number;
  failedRetrievals: number;
  retrievalSuccessRate: number;
  avgRetrievalLatencyMs: number;
  avgRetrievalTtfbMs: number;
  avgRetrievalThroughputBps: number;
  totalDataRetrievedBytes: string;
  healthScore: number;
  avgDealSize?: number;
  lastDealAt: Date;
  lastRetrievalAt: Date;
  refreshedAt: Date;
}

/**
 * Combined provider performance (weekly + all-time)
 */
export interface ProviderCombinedPerformance {
  provider: Provider;
  weekly: ProviderPerformanceDto | null;
  allTime: ProviderPerformanceDto | null;
}

/**
 * Provider list response with pagination
 */
export interface ProvidersListResponse {
  providers: ProviderCombinedPerformance[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/**
 * Provider detail response (single provider)
 */
export interface ProviderDetailResponse {
  provider: Provider;
  weekly: ProviderPerformanceDto;
  allTime: ProviderPerformanceDto;
}

/**
 * Query options for listing providers
 */
export interface ProvidersQueryOptions {
  page?: number;
  limit?: number;
  activeOnly?: boolean;
  approvedOnly?: boolean;
  sortBy?: "healthScore" | "totalDeals" | "totalRetrievals" | "dealSuccessRate" | "retrievalSuccessRate";
  sortOrder?: "asc" | "desc";
}

/**
 * Provider health status
 */
export type ProviderHealthStatus = "excellent" | "good" | "fair" | "poor" | "inactive";

/**
 * Provider health calculation result
 */
export interface ProviderHealth {
  status: ProviderHealthStatus;
  score: number; // 0-100
  dealScore: number;
  retrievalScore: number;
  isActive: boolean;
}

/**
 * Time window metadata
 */
export interface WindowDto {
  startDate: string;
  endDate: string;
  days: number;
  preset: string | null;
}

/**
 * Provider window performance response
 */
export interface ProviderWindowPerformanceDto {
  provider: Provider;
  window: WindowDto;
  metrics: ProviderPerformanceDto;
}

export interface ProviderWindowQueryOptions {
  startDate?: string;
  endDate?: string;
  preset?: string;
}
