import type { Logger } from "@nestjs/common";
import type { DataSetLogContext, ProviderJobContext } from "../common/logging.js";
import type { DealService } from "../deal/deal.service.js";

export interface DataSetTerminationDeps {
  dealService: Pick<
    DealService,
    "getDataSetProvisioningStatus" | "terminateManagedDataSet" | "recordDataSetTerminationSkipped"
  >;
  logger: Logger;
}

/**
 * Returns a randomly shuffled copy of the candidate slot indices `[start, minDataSets)`,
 * where `start = max(1, minIndex)`. Fisher-Yates.
 *
 * The lower bound is clamped to `1` so slot `0` data-set is never a candidate.
 */
function shuffledCandidateIndices(minIndex: number, minDataSets: number): number[] {
  const start = Math.max(1, minIndex);
  const indices: number[] = [];
  for (let i = start; i < minDataSets; i++) {
    indices.push(i);
  }
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

/**
 * Terminates at most one managed data-set slot per invocation (the canary trigger).
 *
 * Scans the canary window `[minIndex, minDataSets)` in random order and acts on the
 * first slot that is `live` or `terminated`:
 *   - terminate it on-chain and wait for FWSS `pdpEndEpoch != 0`, marking its deals
 *     cleaned up. `data_set_creation` recreates the resulting `missing` slot on a
 *     later tick.
 * `missing` slots are skipped (nothing to terminate; a replacement is already pending
 * in `data_set_creation`). If every candidate is `missing`, emits `skipped.no_candidate`.
 *
 * Slots `0..(minIndex - 1)` are never touched, and slot `0` (the baseline data-set) is
 * always protected because the canary window starts at `max(1, minIndex)`. Every
 * candidate index is therefore `>= 1` and is tagged with `{ dealbotDS: String(i) }`,
 * matching the slot metadata produced by `data_set_creation`.
 */
export async function terminateNextDataSet(
  deps: DataSetTerminationDeps,
  spAddress: string,
  minDataSets: number,
  minIndex: number,
  baseDataSetMetadata: Record<string, string>,
  dataSetLogContext: ProviderJobContext,
  pollTimeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const { dealService, logger } = deps;

  const candidates = shuffledCandidateIndices(minIndex, minDataSets);
  let skippedMissingCount = 0;

  for (const i of candidates) {
    signal?.throwIfAborted();

    // Candidates are always >= 1 (slot 0 is the protected baseline), so every slot in
    // the canary window carries its dealbotDS tag, matching data_set_creation's slots.
    const metadata: Record<string, string> = {
      ...baseDataSetMetadata,
      dealbotDS: String(i),
    };

    const logContext: DataSetLogContext = {
      ...dataSetLogContext,
      metadata,
      dataSetIndex: i,
    };

    const status = await dealService.getDataSetProvisioningStatus(spAddress, metadata, signal);

    if (status.status === "missing") {
      skippedMissingCount++;
      logger.debug({
        ...logContext,
        event: "data_set_termination_slot_skipped_missing",
        message: "Slot is missing; nothing to terminate (data_set_creation will replenish it)",
      });
      continue;
    }

    logger.log({
      ...logContext,
      event: "terminating_data_set",
      message: "Terminating managed data-set slot",
      slotStatus: status.status,
      dataSetId: status.dataSetId.toString(),
    });
    const result = await dealService.terminateManagedDataSet(spAddress, status.dataSetId, signal, pollTimeoutMs);
    logger.log({
      ...logContext,
      event: "data_set_termination_completed",
      message: "Terminated managed data-set; deferring recreation to data_set_creation",
      dataSetId: status.dataSetId.toString(),
      dealsAffected: result.dealsAffected,
      skippedMissingCount,
    });
    return;
  }

  // Every candidate slot resolved as `missing`: nothing to terminate this tick. This is
  // expected right after a termination when data_set_creation has not yet replenished
  // the slot. Persistent skips indicate creation is lagging behind termination.
  dealService.recordDataSetTerminationSkipped(spAddress);
  logger.log({
    ...dataSetLogContext,
    event: "data_set_termination_skipped_no_candidate",
    message: "No eligible slot to terminate; all candidate slots are missing",
    minDataSets,
    minIndex,
    skippedMissingCount,
  });
}
