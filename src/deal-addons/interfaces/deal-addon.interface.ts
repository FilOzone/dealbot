import type { Deal } from "../../database/entities/deal.entity.js";
import type { ServiceType } from "../../database/types.js";
import type { AddonExecutionContext, DealConfiguration, PreprocessingResult } from "../types.js";

/**
 * Interface for deal add-on strategies
 * Each add-on implements this interface to provide specific functionality
 * during the deal creation process
 */
export interface IDealAddon {
  /**
   * Unique identifier for the add-on
   * @example 'cdn', 'ipni', 'direct'
   */
  readonly name: ServiceType;

  /**
   * Execution priority (lower number = higher priority)
   * Determines the order in which add-ons are executed during preprocessing
   * @see AddonPriority enum for standard priority levels
   */
  readonly priority: number;

  /**
   * Check if this add-on should be applied for the given deal configuration
   * @param config - Deal configuration with add-on flags
   * @returns true if this add-on should be executed
   */
  isApplicable(config: DealConfiguration): boolean;

  /**
   * Preprocess data before upload
   * This is where add-ons perform their main work (e.g., CAR conversion for IPNI)
   *
   * @param context - Execution context with current data and metadata
   * @returns Preprocessing result with transformed data and metadata
   * @throws Error if preprocessing fails
   */
  preprocessData(context: AddonExecutionContext): Promise<PreprocessingResult>;

  /**
   * Get Synapse SDK configuration for this add-on
   * These configurations are merged by the orchestrator
   *
   * @returns Partial Synapse configuration object
   */
  getSynapseConfig(): Partial<{ withCDN: boolean; withIpni: boolean }>;

  /**
   * Optional post-processing after deal creation
   * Use this for cleanup, validation, or additional operations
   *
   * @param deal - Created deal entity
   * @returns Promise that resolves when post-processing is complete
   */
  postProcess?(deal: Deal): Promise<void>;

  /**
   * Optional validation of preprocessing result
   * Use this to verify the processed data meets requirements
   *
   * @param result - Preprocessing result to validate
   * @returns true if validation passes
   * @throws Error with descriptive message if validation fails
   */
  validate?(result: PreprocessingResult): Promise<boolean>;
}
