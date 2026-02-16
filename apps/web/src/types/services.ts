/**
 * Service type comparison definitions
 * Maps to /api/v1/metrics/daily/service-comparison endpoint
 */

/**
 * Service types for retrieval methods
 */
export const ServiceType = {
  DIRECT_SP: "direct_sp",
  IPFS_PIN: "ipfs_pin",
} as const;

export type ServiceType = (typeof ServiceType)[keyof typeof ServiceType];

/**
 * Metrics for a specific service type
 */
export interface ServiceMetrics {
  totalRetrievals: number;
  successfulRetrievals: number;
  successRate: number; // Percentage
  avgLatencyMs: number;
  avgTtfbMs: number;
  avgThroughputBps: number;
  totalDataRetrievedBytes: string; // BigInt as string
}

/**
 * Service comparison metrics for a specific date
 * Breaks down by service type (DIRECT_SP, IPFS_PIN)
 */
export interface ServiceComparisonMetrics {
  date: string; // ISO date string (YYYY-MM-DD)
  directSp: ServiceMetrics;
  ipfsPin: ServiceMetrics;
}

/**
 * Service comparison response with summary
 */
export interface ServiceComparisonResponse {
  dailyMetrics: ServiceComparisonMetrics[];
  dateRange: {
    startDate: string; // YYYY-MM-DD
    endDate: string; // YYYY-MM-DD
  };
  summary: {
    totalDays: number;
    directSpTotalRetrievals: number;
    ipfsPinTotalRetrievals: number;
    directSpAvgSuccessRate: number;
    ipfsPinAvgSuccessRate: number;
  };
}

/**
 * Query options for service comparison
 */
export interface ServiceComparisonQueryOptions {
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
}
