import { Injectable, Logger } from "@nestjs/common";
import type { CdnMetadata } from "../../database/types.js";
import { ServiceType } from "../../database/types.js";
import type { IDealAddon } from "../interfaces/deal-addon.interface.js";
import type { AddonExecutionContext, CdnPreprocessingResult, DealConfiguration } from "../types.js";
import { AddonPriority } from "../types.js";

/**
 * CDN (Content Delivery Network) add-on strategy
 * Enables fast content retrieval through CDN distribution
 * CDN doesn't require data preprocessing but adds retrieval capabilities
 */
@Injectable()
export class CdnAddonStrategy implements IDealAddon<CdnMetadata> {
  private readonly logger = new Logger(CdnAddonStrategy.name);

  readonly name = ServiceType.CDN;
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
  async preprocessData(context: AddonExecutionContext): Promise<CdnPreprocessingResult> {
    this.logger.debug(`Enabling CDN for file: ${context.currentData.name}`);

    // CDN doesn't modify the data, just adds metadata
    const metadata: CdnMetadata = {
      enabled: true,
      provider: "fil-beam",
    };

    return {
      metadata,
      data: context.currentData.data,
      size: context.currentData.size,
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
   * Validate that CDN metadata is properly set
   */
  async validate(result: CdnPreprocessingResult): Promise<boolean> {
    if (!result.metadata.enabled) {
      throw new Error("CDN validation failed: cdnEnabled flag not set");
    }

    if (!result.data || result.size === 0) {
      throw new Error("CDN validation failed: data is empty");
    }

    return true;
  }
}
