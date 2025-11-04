import type { Hex } from "../common/types.js";
import type { Deal } from "../database/entities/deal.entity.js";
import type { ServiceType } from "..//database/types.js";

/**
 * Configuration for performing a retrieval with add-on support
 */
export interface RetrievalConfiguration {
  /** Deal entity containing metadata about storage and add-ons */
  deal: Deal;

  /** Wallet address for CDN URL construction */
  walletAddress: Hex;

  /** Storage provider address */
  storageProvider: Hex;
}

/**
 * Result of URL construction by a retrieval strategy
 */
export interface RetrievalUrlResult {
  /** Constructed URL for retrieval */
  url: string;

  /** Method/strategy used for this URL */
  method: ServiceType;

  /** Url headers */
  headers?: Record<string, string>;
}

/**
 * Result of data validation after retrieval
 */
export interface ValidationResult {
  /** Whether validation passed */
  isValid: boolean;

  /** Validation method used */
  method: string;

  /** Details about validation */
  details?: string;

  /** Expected vs actual comparison data */
  comparison?: {
    expected: any;
    actual: any;
  };
}

/**
 * Complete result of retrieval execution
 */
export interface RetrievalExecutionResult {
  /** URL used for retrieval */
  url: string;

  /** Strategy/method name */
  method: ServiceType;

  /** Retrieved data */
  data: Buffer;

  /** Response metrics */
  metrics: {
    latency: number;
    ttfb: number;
    throughput: number;
    statusCode: number;
    timestamp: Date;
    responseSize: number;
  };

  /** Validation result (if performed) */
  validation?: ValidationResult;

  /** Success status */
  success: boolean;

  /** Error message if failed */
  error?: string;

  /** Number of retry attempts made (0 = first attempt succeeded, 1+ = retries were needed) */
  retryCount?: number;
}

/**
 * Retrieval test result for comparing multiple methods
 */
export interface RetrievalTestResult {
  /** Deal being tested */
  dealId: string;

  /** Results from all applicable strategies */
  results: RetrievalExecutionResult[];

  /** Summary statistics */
  summary: {
    totalMethods: number;
    successfulMethods: number;
    failedMethods: number;
    fastestMethod?: string;
    fastestLatency?: number;
  };

  /** Timestamp of test */
  testedAt: Date;
}

/**
 * Priority levels for retrieval strategies
 */
export enum RetrievalPriority {
  /** Highest priority - preferred retrieval method (e.g., CDN) */
  HIGH = 1,

  /** Medium priority - alternative methods (e.g., IPNI) */
  MEDIUM = 5,

  /** Lowest priority - fallback methods (e.g., Direct) */
  LOW = 10,
}

/**
 * Expected characteristics for a retrieval method
 */
export interface ExpectedMetrics {
  /** Expected latency range (ms) */
  latencyRange?: {
    min: number;
    max: number;
  };

  /** Expected TTFB range (ms) */
  ttfbRange?: {
    min: number;
    max: number;
  };

  /** Expected throughput range (bytes/sec) */
  throughputRange?: {
    min: number;
    max: number;
  };
}
