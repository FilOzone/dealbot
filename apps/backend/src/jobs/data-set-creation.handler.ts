import type { Logger } from "@nestjs/common";
import type { DealService } from "../deal/deal.service.js";

export interface DataSetCreationDeps {
  dealService: Pick<DealService, "getSynapseInstance" | "findProviderDataSets" | "createDataSetContext">;
  logger: Logger;
}

/**
 * Ensures all required data-sets exist for a provider by deterministically
 * looping through indices 0..minDataSets-1 and creating any that are missing.
 *
 * Index 0 is the initial data-set (no dealbotDS metadata).
 * Indices 1+ are tagged with { dealbotDS: String(i) }.
 *
 * This function only creates data-set contexts (via synapse.storage.createContext);
 * it does not upload data or create deals.
 */
export async function provisionDataSets(
  deps: DataSetCreationDeps,
  spAddress: string,
  minDataSets: number,
): Promise<void> {
  const { dealService, logger } = deps;
  const synapse = await dealService.getSynapseInstance();
  const providerDataSets = await dealService.findProviderDataSets(synapse, spAddress);

  for (let i = 0; i < minDataSets; i++) {
    const metadata: Record<string, string> = i > 0 ? { dealbotDS: String(i) } : {};
    const alreadyExists =
      i === 0
        ? providerDataSets.some((ds) => !ds.metadata?.dealbotDS)
        : providerDataSets.some((ds) => ds.metadata?.dealbotDS === String(i));

    if (alreadyExists) {
      continue;
    }

    logger.log(`Creating data set #${i} for provider ${spAddress}`);
    await dealService.createDataSetContext(synapse, spAddress, metadata);
  }
}
