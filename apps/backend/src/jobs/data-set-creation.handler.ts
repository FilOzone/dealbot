import type { Logger } from "@nestjs/common";
import type { DataSetLogContext, ProviderJobContext } from "../common/logging.js";
import { Network } from "../common/types.js";
import type { DealService } from "../deal/deal.service.js";

export interface DataSetCreationDeps {
  dealService: Pick<DealService, "getDataSetProvisioningStatus" | "createDataSetWithPiece" | "repairTerminatedDataSet">;
  logger: Logger;
}

/**
 * Creates at most one missing data-set per invocation for incremental provisioning.
 *
 * Loops through indices 0..minDataSets-1, classifies each slot as
 * `missing | live | terminated`, and acts on the first non-live slot:
 *   - terminated: terminate + wait for FWSS pdpEndEpoch != 0 + mark deals
 *     cleaned up. Returns without provisioning a replacement this tick — the
 *     next tick will see the slot as `missing`.
 *   - missing: provision a replacement via createDataSetWithPiece.
 *
 * Index 0 is the initial data-set (no dealbotDS metadata).
 * Indices 1+ are tagged with { dealbotDS: String(i) }.
 */
export async function provisionNextMissingDataSet(
  deps: DataSetCreationDeps,
  spAddress: string,
  network: Network,
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

    const status = await dealService.getDataSetProvisioningStatus(spAddress, metadata, network, signal);

    if (status.status === "live") {
      existingCount++;
      continue;
    }

    if (status.status === "terminated") {
      logger.warn({
        ...logContext,
        event: "dataset_terminated_detected",
        message: "Detected PDP-terminated dataset; running repair",
        dataSetId: status.dataSetId.toString(),
      });
      const result = await dealService.repairTerminatedDataSet(spAddress, status.dataSetId, network, signal);
      logger.log({
        ...logContext,
        event: "data_set_repair_completed",
        message: "Repaired terminated dataset; deferring replacement to next tick",
        dataSetId: status.dataSetId.toString(),
        dealsAffected: result.dealsAffected,
      });
      return;
    }

    logger.log({
      ...logContext,
      event: "creating_provisioned_data_set",
      message: "Creating provisioned data-set",
    });
    await dealService.createDataSetWithPiece(spAddress, metadata, network, signal);
    logger.log({
      ...logContext,
      event: "data_set_provisioning_progress",
      message: "Created 1 data-set, deferring remaining to next run",
      minDataSets,
      skippedExistingCount: existingCount,
      uncheckedCount: minDataSets - i - 1,
    });
    return;
  }

  logger.log({
    ...dataSetLogContext,
    event: "data_sets_provisioning_completed",
    message: "All required data-sets exist for provider",
    minDataSets,
    existingCount,
  });
}
