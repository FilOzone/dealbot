import { Injectable, Logger } from "@nestjs/common";
import type { DirectMetadata } from "../../database/types.js";
import { ServiceType } from "../../database/types.js";
import type { IDealAddon } from "../interfaces/deal-addon.interface.js";
import type { AddonExecutionContext, DealConfiguration, DirectPreprocessingResult } from "../types.js";
import { AddonPriority } from "../types.js";

/**
 * Direct storage add-on strategy
 * Provides basic storage without any additional services
 * This is the baseline strategy that passes data through without modification
 */
@Injectable()
export class DirectAddonStrategy implements IDealAddon<DirectMetadata> {
  private readonly logger = new Logger(DirectAddonStrategy.name);

  readonly name = ServiceType.DIRECT_SP;
  readonly priority = AddonPriority.LOW; // Run last as it doesn't transform data

  /**
   * Direct storage is always applicable as the base case
   * It's the fallback when no other add-ons are enabled
   */
  isApplicable(_config: DealConfiguration): boolean {
    // Direct storage is always available
    return true;
  }

  /**
   * Pass through data without modification
   * Direct storage doesn't require any preprocessing
   */
  async preprocessData(context: AddonExecutionContext): Promise<DirectPreprocessingResult> {
    this.logger.debug(`Processing direct storage for file: ${context.currentData.name}`);

    const metadata: DirectMetadata = {
      type: "direct",
    };

    return {
      metadata,
      data: context.currentData.data,
      size: context.currentData.size,
    };
  }

  /**
   * Direct storage doesn't require special Synapse configuration
   */
  getSynapseConfig(): Partial<{ withCDN: boolean; withIpni: boolean }> {
    return {};
  }

  /**
   * Validate that data was passed through correctly
   */
  async validate(result: DirectPreprocessingResult): Promise<boolean> {
    if (!result.data || result.size === 0) {
      throw new Error("Direct storage validation failed: data is empty");
    }

    if (result.data.length !== result.size) {
      throw new Error(
        `Direct storage validation failed: size mismatch (expected ${result.size}, got ${result.data.length})`,
      );
    }

    return true;
  }
}
