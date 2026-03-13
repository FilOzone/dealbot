import { Injectable, Logger } from "@nestjs/common";
import { awaitWithAbort } from "../common/abort-utils.js";
import { type DealLogContext, ProviderJobContext, toStructuredError } from "../common/logging.js";
import type { Deal } from "../database/entities/deal.entity.js";
import type { DealMetadata } from "../database/types.js";
import { ServiceType } from "../database/types.js";
import type { IDealAddon } from "./interfaces/deal-addon.interface.js";
import { IpniAddonStrategy } from "./strategies/ipni.strategy.js";
import type { AddonExecutionContext, DealConfiguration, DealPreprocessingResult, SynapseConfig } from "./types.js";

/**
 * Orchestrator service for managing deal add-ons
 * Coordinates the execution of multiple add-on strategies during deal creation
 * Implements the Strategy Pattern with a pipeline architecture
 */
@Injectable()
export class DealAddonsService {
  private readonly logger = new Logger(DealAddonsService.name);
  private readonly addons: Map<string, IDealAddon> = new Map();

  constructor(private readonly ipniAddon: IpniAddonStrategy) {
    this.registerAddons();
  }

  /**
   * Register all available add-ons
   * Add-ons are registered in a map for easy lookup and management
   * @private
   */
  private registerAddons(): void {
    this.registerAddon(this.ipniAddon);

    this.logger.log({
      event: "deal_addons_registered",
      message: "Deal add-ons registered",
      count: this.addons.size,
      addons: Array.from(this.addons.keys()),
    });
  }

  /**
   * Register a single add-on strategy
   * @param addon - Add-on strategy to register
   * @private
   */
  private registerAddon(addon: IDealAddon): void {
    if (this.addons.has(addon.name)) {
      this.logger.warn({
        event: "deal_addon_duplicate",
        message: "Add-on already registered, skipping",
        addon: addon.name,
      });
      return;
    }

    this.addons.set(addon.name, addon);
    this.logger.debug({
      event: "deal_addon_registered",
      message: "Registered add-on",
      addon: addon.name,
      priority: addon.priority,
    });
  }

  /**
   * Main preprocessing method
   * Orchestrates the execution of applicable add-ons in priority order
   *
   * @param config - Deal configuration with add-on flags
   * @returns Complete preprocessing result with processed data and metadata
   * @throws Error if preprocessing fails
   */
  async preprocessDeal(
    config: DealConfiguration,
    signal?: AbortSignal,
    logContext?: ProviderJobContext,
  ): Promise<DealPreprocessingResult> {
    const startTime = Date.now();
    this.logger.log({
      event: "deal_preprocessing_started",
      message: "Starting deal preprocessing",
      fileName: config.dataFile.name,
    });

    try {
      // Get applicable add-ons based on configuration
      const applicableAddons = this.getApplicableAddons(config);

      if (applicableAddons.length === 0) {
        this.logger.error({
          ...logContext,
          event: "no_deal_preprocessing_addons",
          enableIpni: config.enableIpni,
        });

        throw new Error("No deal preprocessing addons found");
      }

      // Sort by priority (lower number = higher priority)
      const sortedAddons = this.sortAddonsByPriority(applicableAddons);

      this.logger.debug({
        event: "deal_preprocessing_pipeline",
        message: "Executing add-ons",
        count: sortedAddons.length,
        order: sortedAddons.map((a) => a.name),
      });

      // Execute preprocessing pipeline
      const pipelineResult = await this.executePreprocessingPipeline(sortedAddons, config, signal);

      // Merge Synapse configurations from all add-ons
      const synapseConfig = this.mergeSynapseConfigs(sortedAddons, pipelineResult.aggregatedMetadata);

      const duration = Date.now() - startTime;
      this.logger.log({
        event: "deal_preprocessing_completed",
        message: "Deal preprocessing completed",
        durationMs: duration,
        appliedAddons: pipelineResult.appliedAddons,
      });

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
      this.logger.error({
        event: "deal_preprocessing_failed",
        message: "Deal preprocessing failed",
        error: toStructuredError(error),
      });
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Deal preprocessing failed: ${errorMessage}`);
    }
  }

  /**
   * Execute onUploadComplete handlers for all applicable add-ons
   * Called when upload is complete to trigger tracking and monitoring
   *
   * @param deal - Deal entity with upload information
   * @param appliedAddons - Names of add-ons that were applied during preprocessing
   */
  async handleUploadComplete(
    deal: Deal,
    appliedAddons: ServiceType[],
    signal?: AbortSignal,
    logContext?: Partial<DealLogContext>,
  ): Promise<void> {
    signal?.throwIfAborted();

    const dealLogContext: DealLogContext = {
      ...logContext,
      dealId: deal.id,
      providerId: deal.storageProvider?.providerId ?? logContext?.providerId,
      providerAddress: deal.spAddress,
      pieceCid: deal.pieceCid,
      ipfsRootCID: deal.metadata?.[ServiceType.IPFS_PIN]?.rootCID,
    };

    this.logger.debug({
      ...dealLogContext,
      event: "addon_on_upload_complete_started",
      message: "Running onUploadComplete handlers",
    });

    const uploadCompletePromises = appliedAddons
      .map((addonName) => this.addons.get(addonName))
      .filter((addon) => addon?.onUploadComplete)
      .map((addon) => addon!.onUploadComplete!(deal, signal, dealLogContext));

    try {
      await awaitWithAbort(Promise.all(uploadCompletePromises), signal);
      this.logger.debug({
        ...dealLogContext,
        event: "addon_on_upload_complete_completed",
        message: "onUploadComplete handlers completed",
      });
    } catch (error) {
      signal?.throwIfAborted();
      this.logger.warn({
        ...dealLogContext,
        event: "addon_on_upload_complete_failed",
        message: "onUploadComplete handler failed",
        error: toStructuredError(error),
      });
      throw error;
    }
  }

  /**
   * Execute post-processing for all applicable add-ons
   * Called after deal creation to perform cleanup or validation
   *
   * @param deal - Created deal entity
   * @param appliedAddons - Names of add-ons that were applied during preprocessing
   */
  async postProcessDeal(deal: Deal, appliedAddons: string[], logContext?: Partial<DealLogContext>): Promise<void> {
    const dealLogContext: DealLogContext = {
      ...logContext,
      dealId: deal.id,
      providerId: deal.storageProvider?.providerId ?? logContext?.providerId,
      providerAddress: deal.spAddress,
      pieceCid: deal.pieceCid,
      ipfsRootCID: deal.metadata?.[ServiceType.IPFS_PIN]?.rootCID,
    };

    this.logger.debug({
      ...dealLogContext,
      event: "addon_post_process_started",
      message: "Running post-processing",
    });

    const postProcessPromises = appliedAddons
      .map((addonName) => this.addons.get(addonName))
      .filter((addon) => addon?.postProcess)
      .map((addon) => addon!.postProcess!(deal, dealLogContext));

    try {
      await Promise.all(postProcessPromises);
      this.logger.debug({
        ...dealLogContext,
        event: "addon_post_process_completed",
        message: "Post-processing completed",
      });
    } catch (error) {
      this.logger.warn({
        ...dealLogContext,
        event: "addon_post_process_failed",
        message: "Post-processing failed",
        error: toStructuredError(error),
      });
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
        this.logger.debug({
          event: "deal_addon_applicable",
          message: "Add-on is applicable",
          addon: addon.name,
        });
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
    signal?: AbortSignal,
  ): Promise<{
    finalData: Buffer | Uint8Array;
    finalSize: number;
    aggregatedMetadata: DealMetadata;
    appliedAddons: ServiceType[];
  }> {
    // Initialize execution context
    const context: AddonExecutionContext = {
      currentData: config.dataFile,
      accumulatedMetadata: {},
      configuration: config,
    };

    const appliedAddons: ServiceType[] = [];

    // Execute each add-on in sequence
    for (const addon of addons) {
      try {
        this.logger.debug({
          event: "deal_addon_executing",
          message: "Executing add-on for pre-processing data",
          addon: addon.name,
        });

        // Execute preprocessing
        const result = await addon.preprocessData(context, signal);

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

        this.logger.debug({
          event: "deal_addon_completed",
          message: "Add-on completed pre-processing data",
          addon: addon.name,
          sizeBytes: result.size,
          metadataKeys: Object.keys(result.metadata),
        });
      } catch (error) {
        this.logger.error({
          event: "deal_addon_failed",
          message: "Add-on failed to pre-process data",
          addon: addon.name,
          error: toStructuredError(error),
        });
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Add-on ${addon.name} preprocessing failed: ${errorMessage}`);
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
   * @param dealMetadata - Aggregated metadata from preprocessing
   * @returns Merged Synapse configuration with separated metadata
   * @private
   */
  private mergeSynapseConfigs(addons: IDealAddon[], dealMetadata: DealMetadata): SynapseConfig {
    const merged = {
      dataSetMetadata: {},
      pieceMetadata: {},
    };

    for (const addon of addons) {
      const config = addon.getSynapseConfig?.(dealMetadata);
      if (!config) continue;

      // Merge dataSet metadata
      if (config.dataSetMetadata) {
        merged.dataSetMetadata = {
          ...merged.dataSetMetadata,
          ...config.dataSetMetadata,
        };
      }

      // Merge piece metadata
      if (config.pieceMetadata) {
        merged.pieceMetadata = {
          ...merged.pieceMetadata,
          ...config.pieceMetadata,
        };
      }
    }

    const dataSetKeys = Object.keys(merged.dataSetMetadata);
    const pieceKeys = Object.keys(merged.pieceMetadata);
    this.logger.debug({
      event: "synapse_config_merged",
      message: "Merged Synapse config",
      dataSetKeys,
      pieceKeys,
    });

    return merged satisfies SynapseConfig;
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
