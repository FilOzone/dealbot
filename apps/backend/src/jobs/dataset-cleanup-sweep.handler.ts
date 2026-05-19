import type { Logger } from "@nestjs/common";
import { toStructuredError } from "../common/logging.js";
import type { DealService } from "../deal/deal.service.js";

export interface DatasetCleanupSweepDeps {
  dealService: Pick<DealService, "sweepDatasetCleanup">;
  logger: Logger;
  batchSize: number;
}

/**
 * Periodic global job that flips `Deal.cleaned_up=true` for any uncleaned
 * Deal row whose `data_set_id` shows `pdpEndEpoch != 0n` on FWSS (terminated)
 * or whose `getDataSet` returns null (removed).
 *
 * Background: in session-key + multisig payer mode, dealbot cannot
 * auto-terminate datasets. Operators submit `terminateService` via Safe.
 * After the Safe batch lands, synapse-sdk's `createContext` filters out the
 * terminated dataset before `getDataSetProvisioningStatus` can classify it
 * as `terminated`, so `repairTerminatedDataSet` is never invoked for those
 * rows. The retrieval candidate selector keeps picking the stale Deal rows
 * and pollutes failure metrics.
 *
 * This sweeper closes that gap without depending on any chain-side fix.
 * See https://github.com/FilOzone/dealbot/issues/546
 */
export async function runDatasetCleanupSweep(deps: DatasetCleanupSweepDeps): Promise<void> {
  const { dealService, logger, batchSize } = deps;
  const startedAt = Date.now();
  logger.log({
    event: "dataset_cleanup_sweep_started",
    message: "Sweeping uncleaned Deal rows against FWSS state",
    batchSize,
  });
  try {
    const result = await dealService.sweepDatasetCleanup(batchSize);
    logger.log({
      event: "dataset_cleanup_sweep_completed",
      message: "Dataset cleanup sweep completed",
      datasetsChecked: result.datasetsChecked,
      datasetsTerminated: result.datasetsTerminated,
      datasetsDne: result.datasetsDne,
      datasetsLive: result.datasetsLive,
      probeErrors: result.probeErrors,
      dealsAffected: result.dealsAffected,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    logger.error({
      event: "dataset_cleanup_sweep_failed",
      message: "Dataset cleanup sweep failed",
      error: toStructuredError(error),
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}
