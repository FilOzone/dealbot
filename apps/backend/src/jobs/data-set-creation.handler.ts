import type { Logger } from "@nestjs/common";
import type { DataSetLogContext } from "../common/logging.js";
import type { DealService } from "../deal/deal.service.js";

export interface DataSetCreationDeps {
  dealService: Pick<DealService, "checkDataSetExists" | "createDataSet">;
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
  baseDataSetMetadata: Record<string, string>,
  dataSetLogContext: DataSetLogContext,
  signal?: AbortSignal,
): Promise<void> {
  const { dealService, logger } = deps;

  let createdCount = 0;
  for (let i = 0; i < minDataSets; i++) {
    signal?.throwIfAborted();

    const metadata: Record<string, string> = {
      ...baseDataSetMetadata,
      ...(i > 0 ? { dealbotDS: String(i) } : {}),
    };

    const logContext: DataSetLogContext = {
      ...dataSetLogContext,
      dataSetIndex: i,
    };

    // Check if data-set already exists by attempting to resolve its context
    const exists = await dealService.checkDataSetExists(spAddress, metadata, signal);

    if (exists) {
      continue;
    }

    logger.log({
      ...logContext,
      event: "data_set_creation_started",
      message: `Creating data-set #${i} for provider ${spAddress}`,
    });
    const result = await dealService.createDataSet(spAddress, metadata, logContext, signal);
    logContext.dataSetId = result.dataSetId;
    createdCount++;
  }

  logger.log({
    ...dataSetLogContext,
    event: "data_sets_provisioning_completed",
    message: `Data-set provisioning complete for ${spAddress}: ${createdCount} created, ${minDataSets - createdCount} already existed`,
    createdCount,
    minDataSets,
    existingCount: minDataSets - createdCount,
  });
}
