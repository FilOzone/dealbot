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
 * Weekly performance metrics for a storage provider (last 7 days)
 */
export interface ProviderWeeklyPerformance {
  spAddress: string;
  totalDeals: number;
  successfulDeals: number;
  failedDeals: number;
  dealSuccessRate: number;
  totalRetrievals: number;
  successfulRetrievals: number;
  failedRetrievals: number;
  retrievalSuccessRate: number;
  avgDealLatencyMs: number;
  avgChainLatencyMs: number;
  avgIngestLatencyMs: number;
  avgIngestThroughputBps: number;
  avgRetrievalLatencyMs: number;
  avgRetrievalTtfbMs: number;
  avgRetrievalThroughputBps: number;
  totalDataStoredBytes: string; // BigInt as string
  totalDataRetrievedBytes: string; // BigInt as string
  healthScore: number;
  lastDealAt: string;
  lastRetrievalAt: string;
  refreshedAt: string;
}

/**
 * All-time performance metrics for a storage provider
 */
export interface ProviderAllTimePerformance {
  spAddress: string;
  totalDeals: number;
  successfulDeals: number;
  failedDeals: number;
  dealSuccessRate: number;
  totalRetrievals: number;
  successfulRetrievals: number;
  failedRetrievals: number;
  retrievalSuccessRate: number;
  avgDealLatencyMs: number;
  avgChainLatencyMs: number;
  avgIngestLatencyMs: number;
  avgIngestThroughputBps: number;
  avgRetrievalLatencyMs: number;
  avgRetrievalTtfbMs: number;
  avgRetrievalThroughputBps: number;
  totalDataStoredBytes: string; // BigInt as string
  totalDataRetrievedBytes: string; // BigInt as string
  lastDealAt: string;
  lastRetrievalAt: string;
  refreshedAt: string;
}

/**
 * Combined provider performance (weekly + all-time)
 */
export interface ProviderCombinedPerformance {
  provider: Provider;
  weekly: ProviderWeeklyPerformance | null;
  allTime: ProviderAllTimePerformance | null;
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
  weekly: ProviderWeeklyPerformance;
  allTime: ProviderAllTimePerformance;
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
