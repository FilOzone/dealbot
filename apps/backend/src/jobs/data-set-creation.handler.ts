import type { Logger } from "@nestjs/common";
import type { DealService } from "../deal/deal.service.js";

export interface DataSetCreationDeps {
  dealService: Pick<
    DealService,
    "checkDataSetExists" | "createDataSet" | "getTestingDealOptions" | "buildDataSetMetadata"
  >;
  logger: Logger;
}

/**
 * Ensures all required data-sets exist for a provider by deterministically
 * looping through indices 0..minDataSets-1 and creating any that are missing.
 *
 * Index 0 is the initial data-set (no dealbotDS metadata).
 * Indices 1+ are tagged with { dealbotDS: String(i) }.
 *
 * Uses pdpServer.createDataSet() for actual on-chain data-set creation.
 */
export async function provisionDataSets(
  deps: DataSetCreationDeps,
  spAddress: string,
  minDataSets: number,
  signal?: AbortSignal,
): Promise<void> {
  const { dealService, logger } = deps;

  const dealOptions = dealService.getTestingDealOptions();

  let createdCount = 0;
  for (let i = 0; i < minDataSets; i++) {
    signal?.throwIfAborted();

    const extraMetadata: Record<string, string> = i > 0 ? { dealbotDS: String(i) } : {};
    const metadata = await dealService.buildDataSetMetadata(dealOptions.enableIpni, extraMetadata);

    // Check if data-set already exists by attempting to resolve its context
    const exists = await dealService.checkDataSetExists(spAddress, metadata);

    if (exists) {
      continue;
    }

    logger.log(`Creating data-set #${i} for provider ${spAddress}`);
    await dealService.createDataSet(spAddress, metadata);
    createdCount++;
  }

  logger.log(
    `Data-set provisioning complete for ${spAddress}: ${createdCount} created, ${minDataSets - createdCount} already existed`,
  );
}
