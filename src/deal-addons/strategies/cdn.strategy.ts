import { Injectable, Logger } from "@nestjs/common";
import type { IDealAddon } from "../interfaces/deal-addon.interface.js";
import type { DealConfiguration, PreprocessingResult, AddonExecutionContext } from "../types.js";
import { AddonPriority } from "../types.js";
import type { Deal } from "../../database/entities/deal.entity.js";

/**
 * CDN (Content Delivery Network) add-on strategy
 * Enables fast content retrieval through CDN distribution
 * CDN doesn't require data preprocessing but adds retrieval capabilities
 */
@Injectable()
export class CdnAddonStrategy implements IDealAddon {
  private readonly logger = new Logger(CdnAddonStrategy.name);

  readonly name = "cdn";
  readonly priority = AddonPriority.MEDIUM; // Run after data transformation

  /**
   * Check if CDN is enabled in the deal configuration
   */
  isApplicable(config: DealConfiguration): boolean {
    return config.enableCDN;
  }

  /**
   * CDN doesn't require data preprocessing
   * Data is passed through unchanged, but metadata is added for tracking
   */
  async preprocessData(context: AddonExecutionContext): Promise<PreprocessingResult> {
    this.logger.debug(`Enabling CDN for file: ${context.currentData.name}`);

    // CDN doesn't modify the data, just adds metadata
    return {
      data: context.currentData.data,
      size: context.currentData.size,
      metadata: {
        cdnEnabled: true,
        cdnProvider: "fil-beam",
        enabledAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Configure Synapse SDK to enable CDN
   */
  getSynapseConfig(): Partial<{ withCDN: boolean; withIpni: boolean }> {
    return {
      withCDN: true,
    };
  }

  /**
   * Post-process to log CDN enablement
   * Could be extended to verify CDN propagation
   */
  async postProcess(deal: Deal): Promise<void> {
    this.logger.log(`CDN enabled for deal ${deal.id} with CID: ${deal.pieceCid}`);

    // Future: Could add CDN health check or propagation verification
    // await this.verifyCdnPropagation(deal);
  }

  /**
   * Validate that CDN metadata is properly set
   */
  async validate(result: PreprocessingResult): Promise<boolean> {
    if (!result.metadata.cdnEnabled) {
      throw new Error("CDN validation failed: cdnEnabled flag not set");
    }

    if (!result.data || result.size === 0) {
      throw new Error("CDN validation failed: data is empty");
    }

    return true;
  }
}
