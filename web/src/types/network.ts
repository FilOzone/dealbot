/**
 * Network-wide statistics type definitions
 * Maps to /api/v1/providers/network/stats endpoint
 */

/**
 * Overall network statistics across all providers
 */
export interface NetworkOverallStats {
  totalProviders: number;
  activeProviders: number;
  totalDeals: number;
  successfulDeals: number;
  dealSuccessRate: number;
  totalRetrievals: number;
  successfulRetrievals: number;
  retrievalSuccessRate: number;
  totalDataStoredBytes: string; // BigInt as string
  totalDataRetrievedBytes: string; // BigInt as string
  avgDealLatencyMs: number;
  avgRetrievalLatencyMs: number;
  avgRetrievalTtfbMs: number;
  avgIngestLatencyMs: number;
  avgIngestThroughputBps: number;
  avgRetrievalThroughputBps: number;
  lastRefreshedAt: string; // ISO date string
}

/**
 * Network health indicators
 */
export interface NetworkHealth {
  healthScore: number; // 0-100
  dealReliability: number; // Average deal success rate
  retrievalReliability: number; // Average retrieval success rate
  performanceScore: number; // Based on latencies
  diversityScore: number; // Based on number of providers
}

/**
 * Complete network statistics response
 */
export interface NetworkStatsResponse {
  overall: NetworkOverallStats;
  health: NetworkHealth;
}
