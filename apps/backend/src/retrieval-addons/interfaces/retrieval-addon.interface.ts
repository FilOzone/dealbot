import type { ServiceType } from "../../database/types.js";
import type { ExpectedMetrics, RetrievalConfiguration, RetrievalUrlResult, ValidationResult } from "../types.js";

/**
 * Interface for retrieval add-on strategies
 * Each add-on implements this interface to provide specific retrieval methods
 * (CDN, IPNI, Direct, etc.)
 */
export interface IRetrievalAddon {
  /**
   * Unique identifier for the retrieval method
   * @example 'cdn', 'ipni', 'direct'
   */
  readonly name: ServiceType;

  /**
   * Execution priority (lower number = higher priority)
   * Determines the order in which retrieval methods are attempted
   * @see RetrievalPriority enum for standard priority levels
   */
  readonly priority: number;

  /**
   * Check if this retrieval method can handle the given deal
   * Based on deal metadata and add-ons that were used during storage
   *
   * @param config - Retrieval configuration with deal metadata
   * @returns true if this method can retrieve the deal
   */
  canHandle(config: RetrievalConfiguration): boolean;

  /**
   * Construct the retrieval URL for this method
   *
   * @param config - Retrieval configuration
   * @returns URL result with constructed URL and metadata
   * @throws Error if URL construction fails
   */
  constructUrl(config: RetrievalConfiguration): RetrievalUrlResult;

  /**
   * Optional: Validate retrieved data against expected data
   * Use this to verify data integrity after retrieval
   *
   * @param retrievedData - Data retrieved from the URL
   * @param config - Original retrieval configuration
   * @returns Validation result with status and details
   */
  validateData?(retrievedData: Buffer, config: RetrievalConfiguration): Promise<ValidationResult>;

  /**
   * Optional: Get expected performance metrics for this retrieval method
   * Useful for monitoring and alerting on performance degradation
   *
   * @returns Expected metrics ranges
   */
  getExpectedMetrics?(): ExpectedMetrics;

  /**
   * Optional: Prepare or transform data before validation
   * Use this if retrieved data needs preprocessing (e.g., CAR extraction)
   *
   * @param retrievedData - Raw retrieved data
   * @returns Processed data ready for validation
   */
  preprocessRetrievedData?(retrievedData: Buffer): Promise<Buffer>;

  /**
   * Optional: Get retry configuration for this retrieval method
   * Useful for strategies that need multiple attempts (e.g., CDN cache warming)
   *
   * @returns Retry configuration with attempt count and delay
   */
  getRetryConfig?(): {
    attempts: number;
    delayMs: number;
  };
}
