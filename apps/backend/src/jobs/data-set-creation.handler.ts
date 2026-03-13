import type { Logger } from "@nestjs/common";
import type { DataSetLogContext, ProviderJobContext } from "../common/logging.js";
import type { DealService } from "../deal/deal.service.js";

export interface DataSetCreationDeps {
  dealService: Pick<DealService, "checkDataSetExists" | "createDataSetWithPiece">;
  logger: Logger;
}

/**
 * Creates at most one missing data-set per invocation for incremental provisioning.
 *
 * Loops through indices 0..minDataSets-1, skips existing data-sets, and creates
 * the first missing one then returns. The scheduler fires subsequent jobs to
 * converge on the full set over multiple runs.
 *
 * Index 0 is the initial data-set (no dealbotDS metadata).
 * Indices 1+ are tagged with { dealbotDS: String(i) }.
 *
 * Uses createContext + executeUpload with a 200 KiB piece for on-chain data-set creation
 * (empty datasets are being removed from curio and synapse-sdk).
 */
export async function provisionNextMissingDataSet(
  deps: DataSetCreationDeps,
  spAddress: string,
  minDataSets: number,
  baseDataSetMetadata: Record<string, string>,
  dataSetLogContext: ProviderJobContext,
  signal?: AbortSignal,
): Promise<void> {
  const { dealService, logger } = deps;

  let existingCount = 0;
  for (let i = 0; i < minDataSets; i++) {
    signal?.throwIfAborted();

    const metadata: Record<string, string> = {
      ...baseDataSetMetadata,
      ...(i > 0 ? { dealbotDS: String(i) } : {}),
    };

    const logContext: DataSetLogContext = {
      ...dataSetLogContext,
      metadata,
      dataSetIndex: i,
    };

    // Check if data-set already exists by attempting to resolve its context
    const exists = await dealService.checkDataSetExists(spAddress, metadata, signal);

    if (exists) {
      existingCount++;
      continue;
    }

    logger.log({
      ...logContext,
      event: "creating_provisioned_data_set",
      message: "Creating provisioned data-set",
    });
    await dealService.createDataSetWithPiece(spAddress, metadata, signal);
    logger.log({
      ...logContext,
      event: "created_provisioned_data_set",
      message: "Created provisioned data-set",
    });

    logger.log({
      ...dataSetLogContext,
      event: "data_set_provisioning_progress",
      message: "Created 1 data-set, deferring remaining to next run",
      createdCount: 1,
      createdIndex: i,
      minDataSets,
      checkedExistingCount: existingCount,
      uncheckedCount: minDataSets - existingCount - 1,
    });
    return;
  }

  logger.log({
    ...dataSetLogContext,
    event: "data_sets_provisioning_completed",
    message: "Data-set provisioning completed for provider",
    createdCount: 0,
    minDataSets,
    existingCount,
  });
}
