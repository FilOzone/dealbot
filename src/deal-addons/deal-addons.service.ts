import { Injectable, Logger } from "@nestjs/common";
import type { Deal } from "../database/entities/deal.entity.js";
import type { IDealAddon } from "./interfaces/deal-addon.interface.js";
import type { CdnAddonStrategy } from "./strategies/cdn.strategy.js";
import type { DirectAddonStrategy } from "./strategies/direct.strategy.js";
import type { IpniAddonStrategy } from "./strategies/ipni.strategy.js";
import type {
  AddonExecutionContext,
  DealConfiguration,
  DealPreprocessingResult,
  PreprocessingResult,
} from "./types.js";

/**
 * Orchestrator service for managing deal add-ons
 * Coordinates the execution of multiple add-on strategies during deal creation
 * Implements the Strategy Pattern with a pipeline architecture
 */
@Injectable()
export class DealAddonsService {
  private readonly logger = new Logger(DealAddonsService.name);
  private readonly addons: Map<string, IDealAddon> = new Map();

  constructor(
    private readonly directAddon: DirectAddonStrategy,
    private readonly cdnAddon: CdnAddonStrategy,
    private readonly ipniAddon: IpniAddonStrategy,
  ) {
    this.registerAddons();
  }

  /**
   * Register all available add-ons
   * Add-ons are registered in a map for easy lookup and management
   * @private
   */
  private registerAddons(): void {
    this.registerAddon(this.directAddon);
    this.registerAddon(this.cdnAddon);
    this.registerAddon(this.ipniAddon);

    this.logger.log(`Registered ${this.addons.size} deal add-ons: ${Array.from(this.addons.keys()).join(", ")}`);
  }

  /**
   * Register a single add-on strategy
   * @param addon - Add-on strategy to register
   * @private
   */
  private registerAddon(addon: IDealAddon): void {
    if (this.addons.has(addon.name)) {
      this.logger.warn(`Add-on ${addon.name} is already registered, skipping`);
      return;
    }

    this.addons.set(addon.name, addon);
    this.logger.debug(`Registered add-on: ${addon.name} (priority: ${addon.priority})`);
  }

  /**
   * Main preprocessing method
   * Orchestrates the execution of applicable add-ons in priority order
   *
   * @param config - Deal configuration with add-on flags
   * @returns Complete preprocessing result with processed data and metadata
   * @throws Error if preprocessing fails
   */
  async preprocessDeal(config: DealConfiguration): Promise<DealPreprocessingResult> {
    const startTime = Date.now();
    this.logger.log(`Starting deal preprocessing for file: ${config.dataFile.name}`);

    try {
      // Get applicable add-ons based on configuration
      const applicableAddons = this.getApplicableAddons(config);

      if (applicableAddons.length === 0) {
        this.logger.warn("No applicable add-ons found, using direct storage");
        applicableAddons.push(this.directAddon);
      }

      // Sort by priority (lower number = higher priority)
      const sortedAddons = this.sortAddonsByPriority(applicableAddons);

      this.logger.debug(
        `Executing ${sortedAddons.length} add-ons in order: ${sortedAddons.map((a) => a.name).join(" → ")}`,
      );

      // Execute preprocessing pipeline
      const pipelineResult = await this.executePreprocessingPipeline(sortedAddons, config);

      // Merge Synapse configurations from all add-ons
      const synapseConfig = this.mergeSynapseConfigs(sortedAddons);

      const duration = Date.now() - startTime;
      this.logger.log(
        `Deal preprocessing completed in ${duration}ms. ` +
          `Applied add-ons: ${pipelineResult.appliedAddons.join(", ")}`,
      );

      return {
        processedData: {
          data: pipelineResult.finalData,
          size: pipelineResult.finalSize,
          name: config.dataFile.name,
        },
        metadata: pipelineResult.aggregatedMetadata,
        synapseConfig,
        appliedAddons: pipelineResult.appliedAddons,
      };
    } catch (error) {
      this.logger.error(`Deal preprocessing failed: ${error.message}`, error.stack);
      throw new Error(`Deal preprocessing failed: ${error.message}`);
    }
  }

  /**
   * Execute post-processing for all applicable add-ons
   * Called after deal creation to perform cleanup or validation
   *
   * @param deal - Created deal entity
   * @param appliedAddons - Names of add-ons that were applied during preprocessing
   */
  async postProcessDeal(deal: Deal, appliedAddons: string[]): Promise<void> {
    this.logger.debug(`Running post-processing for deal ${deal.id}`);

    const postProcessPromises = appliedAddons
      .map((addonName) => this.addons.get(addonName))
      .filter((addon) => addon?.postProcess)
      .map((addon) => addon!.postProcess!(deal));

    try {
      await Promise.all(postProcessPromises);
      this.logger.debug(`Post-processing completed for deal ${deal.id}`);
    } catch (error) {
      this.logger.warn(`Post-processing failed for deal ${deal.id}: ${error.message}`);
      // Don't throw - post-processing failures shouldn't break the deal
    }
  }

  /**
   * Get all add-ons that are applicable for the given configuration
   * @param config - Deal configuration
   * @returns Array of applicable add-ons
   * @private
   */
  private getApplicableAddons(config: DealConfiguration): IDealAddon[] {
    const applicable: IDealAddon[] = [];

    for (const addon of this.addons.values()) {
      if (addon.isApplicable(config)) {
        applicable.push(addon);
        this.logger.debug(`Add-on ${addon.name} is applicable`);
      }
    }

    return applicable;
  }

  /**
   * Sort add-ons by priority (ascending order)
   * Lower priority number means higher execution priority
   * @param addons - Add-ons to sort
   * @returns Sorted array of add-ons
   * @private
   */
  private sortAddonsByPriority(addons: IDealAddon[]): IDealAddon[] {
    return [...addons].sort((a, b) => a.priority - b.priority);
  }

  /**
   * Execute the preprocessing pipeline
   * Each add-on processes the data in sequence, with output feeding into the next
   *
   * @param addons - Sorted array of add-ons to execute
   * @param config - Deal configuration
   * @returns Pipeline execution result
   * @private
   */
  private async executePreprocessingPipeline(
    addons: IDealAddon[],
    config: DealConfiguration,
  ): Promise<{
    finalData: Buffer | Uint8Array;
    finalSize: number;
    aggregatedMetadata: Record<string, any>;
    appliedAddons: string[];
  }> {
    // Initialize execution context
    const context: AddonExecutionContext = {
      currentData: config.dataFile,
      accumulatedMetadata: {},
      configuration: config,
    };

    const appliedAddons: string[] = [];

    // Execute each add-on in sequence
    for (const addon of addons) {
      try {
        this.logger.debug(`Executing add-on: ${addon.name}`);

        // Execute preprocessing
        const result: PreprocessingResult = await addon.preprocessData(context);

        // Validate result if validation is implemented
        if (addon.validate) {
          await addon.validate(result);
        }

        // Update context for next add-on
        context.currentData = {
          ...context.currentData,
          data: Buffer.isBuffer(result.data) ? result.data : Buffer.from(result.data),
          size: result.size,
        };

        // Accumulate metadata with add-on namespace
        context.accumulatedMetadata[addon.name] = result.metadata;

        appliedAddons.push(addon.name);

        this.logger.debug(
          `Add-on ${addon.name} completed: ${result.size} bytes, ` +
            `metadata keys: ${Object.keys(result.metadata).join(", ")}`,
        );
      } catch (error) {
        this.logger.error(`Add-on ${addon.name} failed: ${error.message}`, error.stack);
        throw new Error(`Add-on ${addon.name} preprocessing failed: ${error.message}`);
      }
    }

    return {
      finalData: context.currentData.data,
      finalSize: context.currentData.size,
      aggregatedMetadata: context.accumulatedMetadata,
      appliedAddons,
    };
  }

  /**
   * Merge Synapse SDK configurations from all add-ons
   * @param addons - Add-ons to merge configurations from
   * @returns Merged Synapse configuration
   * @private
   */
  private mergeSynapseConfigs(addons: IDealAddon[]): { withCDN?: boolean; withIpni?: boolean } {
    const merged: { withCDN?: boolean; withIpni?: boolean } = {};

    for (const addon of addons) {
      const config = addon.getSynapseConfig();
      Object.assign(merged, config);
    }

    this.logger.debug(`Merged Synapse config: ${JSON.stringify(merged)}`);

    return merged;
  }

  /**
   * Get information about all registered add-ons
   * Useful for debugging and monitoring
   * @returns Array of add-on information
   */
  getRegisteredAddons(): Array<{ name: string; priority: number }> {
    return Array.from(this.addons.values()).map((addon) => ({
      name: addon.name,
      priority: addon.priority,
    }));
  }

  /**
   * Check if a specific add-on is registered
   * @param addonName - Name of the add-on to check
   * @returns true if add-on is registered
   */
  isAddonRegistered(addonName: string): boolean {
    return this.addons.has(addonName);
  }
}
