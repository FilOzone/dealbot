# Data Set Deletion Job

This doc proposes a calibration-only `data_set_deletion` job that periodically deletes a managed dataset so the existing `data_set_creation` job naturally recreates it. The goal is to keep dealbot continuously exercising the on-chain `createDataSet` lifecycle instead of only creating datasets until a steady-state cap is reached.

## Problem Context

During the PDPVerifier v3.4.0 rollout, `createDataSet` broke on calibration and mainnet. Dealbot did not detect the calibration outage because providers had already reached the steady-state cap of managed datasets (`MIN_NUM_DATASETS_FOR_CHECKS`). Once the cap was reached, `data_set_creation` stopped exercising the on-chain create path, so the canary value of that job disappeared.

The missing capability is not more creation logic. The missing capability is a controlled way to create fresh demand for creation again.

## Goals

- Continuously exercise the calibration `createDataSet → deleteDataSet → createDataSet` lifecycle.
- Reuse the existing `data_set_creation` job as the replenishment mechanism.
- Minimize disruption to ongoing deal and retrieval checks.
- Make delete cadence explicitly configurable so the expected create cadence can be reasoned about.
- Ensure the job cannot run on mainnet.
- Expose enough metrics and logs to extend the existing BetterStack dashboards.

## Proposed job

Introduce a new SP-scoped job type: `data_set_deletion`.

The job should:

- run only on calibration
- run on a configurable cadence
- delete at most one safe managed dataset per provider per invocation
- rely on the existing `data_set_creation` job to recreate the missing slot on a later tick

This keeps deletion simple and keeps creation logic centralized in the existing job.

### Configuration

The initial design adds these controls, which follow the same naming pattern as the creation job:

- `DATASET_DELETIONS_PER_SP_PER_HOUR`
  - mirrors the existing rate-based job controls
  - converted internally to `intervalSeconds`
  - used to reason about expected delete frequency

- `DATA_SET_DELETION_JOB_TIMEOUT_SECONDS`
  - max runtime for one deletion job invocation

- `DATA_SET_DELETION_MIN_INDEX`
  - the lowest slot index eligible for deletion (inclusive)
  - default: `1` — only the baseline slot (index `0`) is protected
  - slots `0` through `DATA_SET_DELETION_MIN_INDEX - 1` are never touched by this job
  - example: `MIN_NUM_DATASETS_FOR_CHECKS = 10`, `DATA_SET_DELETION_MIN_INDEX = 5` → slots 0–4 are stable, slots 5–9 cycle as the canary window
  - set to `MIN_NUM_DATASETS_FOR_CHECKS` to disable deletion entirely — the canary window becomes empty and no schedule is created
  - must be `>= 1` and `<= MIN_NUM_DATASETS_FOR_CHECKS`; violating either constraint crashes the application on startup

### Scheduling and queueing

The scheduling model mirrors `data_set_creation`:

- queue: shared `sp.work`
- `singletonKey=spAddress`

Sharing the singleton with other SP jobs prevents deletion from racing with a `deal` or `retrieval` job for the same provider.

The schedule is only upserted when all of the following are true:

- `NETWORK=calibration`
- `MIN_NUM_DATASETS_FOR_CHECKS - DATA_SET_DELETION_MIN_INDEX > 0`

The second condition covers the `DATA_SET_DELETION_MIN_INDEX = MIN_NUM_DATASETS_FOR_CHECKS` case (empty canary window, deletion effectively off) without crashing. It also handles the case where `MIN_NUM_DATASETS_FOR_CHECKS` is later lowered to meet `DATA_SET_DELETION_MIN_INDEX` — no schedule is created without requiring a config change.

### Proposed handler algorithm

For one provider, one invocation of `data_set_deletion` works like this:

1. Check that the network is calibration. If not, log skip and exit.
2. Apply the same maintenance-window and SP-blocklist rules used by other SP jobs.
3. Create an `AbortController` using `DATA_SET_DELETION_JOB_TIMEOUT_SECONDS`.
4. Read `MIN_NUM_DATASETS_FOR_CHECKS` and base dataset metadata.
5. Scan slots from `minDataSets - 1` down to `DATA_SET_DELETION_MIN_INDEX`. For each slot:
   - a. Build its metadata using the same logic as `data_set_creation`.
   - b. Classify it via `getDataSetProvisioningStatus()`.
   - c. Skip if `missing` — nothing to delete.
   - d. Skip if `terminated` — this means Synapse returned a `dataSetId` (`pdpEndEpoch === 0`) but liveness probes are failing. `data_set_creation` owns repair of these slots via `repairTerminatedDataSet`. Note: a slot whose `terminateService` was already called will never appear as `terminated` here — the Synapse SDK filters datasets with `pdpEndEpoch !== 0` from metadata lookups, so it shows as `missing` instead.
   - e. Skip if `live` but has any deal row with `cleaned_up = false` — the deal job is still tracking it as active.
6. Call the delete flow on the first slot that passes all skip conditions (reaches step 5e without being skipped).
7. After successful deletion, mark `deals.cleaned_up = true` for all deal rows associated with that `dataSetId` in a single transaction.
8. Log the outcome and exit for this tick.
9. If no eligible slot is found after the full scan, log `skipped.no_candidate` and exit. This is expected when `data_set_creation` has not yet replenished a previously deleted slot.

As with `data_set_creation`, the job performs **at most one state-changing action per invocation**.

### Proposed delete flow

The deletion flow should be implemented in a dedicated service method rather than inline in `JobsService`.

1. Resolve provider info and the target `dataSetId`.
2. Call the on-chain `terminateService` path through Synapse.
3. Wait for transaction receipt.
4. Poll until `pdpEndEpoch !== 0`. A live dataset has `pdpEndEpoch === 0`; once `terminateService` confirms, `pdpEndEpoch !== 0` is set on-chain. The Synapse SDK filters datasets with `pdpEndEpoch !== 0` from metadata lookups, so `getDataSetProvisioningStatus()` will return `missing` for this slot from this point on.
5. Once `pdpEndEpoch !== 0` is observed, the deletion job's work is done. `data_set_creation` will see the slot as `missing` on its next run and provision a replacement directly.

Polling until the chain confirms termination is important because the canary value comes from the full on-chain lifecycle, not just submitting a transaction.

#### Idempotency

The delete flow must tolerate races and retries:

- If `pdpEndEpoch !== 0` is already set when the job starts (slot is already terminated), skip the `terminateService` call and treat the run as a no-op success.
- If `terminateService` reverts with an already-terminated error (for example, `"service already terminated"` or `"dataset not active"`), treat it as idempotent success and proceed to the polling step.
- If the transaction confirms but `pdpEndEpoch` does not become non-zero before the abort signal fires, treat the run as `failure.timedout` and let pg-boss retry on the next tick.

### Metrics and BetterStack dashboards

The deletion job has two distinct observability concerns: is the trigger firing, and is the canary signal it produces showing up in creation metrics. Creation metrics are the primary signal; deletion metrics are only there to confirm the trigger is working.

All metrics carry the standard label set defined in [`checks/events-and-metrics.md`](../checks/events-and-metrics.md#metrics):
`network`, `checkType`, `providerId`, `providerName`, `providerStatus`.

For deletion metrics, `checkType=dataSetDeletion`. For creation metrics referenced below, `checkType=dataSetCreation`.

#### Creation metrics (primary signal)

These already exist and are defined in [`events-and-metrics.md`](../checks/events-and-metrics.md). `data_set_deletion` creates the conditions for them to fire — if they stay silent after deletion is running, something is wrong with creation.

| Metric | `value` labels | What to watch for |
|--------|---------------|-------------------|
| [`dataSetCreationStatus`](../checks/events-and-metrics.md#dataSetCreationStatus) | `pending`, `success`, `failure.timedout`, `failure.other` | `success` count should rise in the interval after each deletion; persistent `failure.*` after a deletion indicates a `createDataSet` regression |
| [`dataSetCreationMs`](../checks/events-and-metrics.md#dataSetCreationMs) | — | Latency histogram for `createDataSetWithPiece`; spikes after deletion may indicate on-chain congestion |

#### Deletion metrics (trigger health)

New metrics proposed here. These confirm deletion is producing the conditions for creation to run. If deletion metrics look healthy but creation metrics are silent, the loop is broken somewhere between the two jobs.

| Metric | `value` labels | What to watch for |
|--------|---------------|-------------------|
| `dataSetDeletionStatus` | `success`, `failure.timedout`, `failure.other`, `skipped.no_candidate` | `success` per provider confirms the trigger is firing; persistent `skipped.no_candidate` means `data_set_creation` is not replenishing fast enough |
| `dataSetDeletionMs` | — | Histogram from `terminateService` call to `pdpEndEpoch !== 0` confirmed; emitted on `success` and `failure.timedout` only. Analogous to [`dataSetCreationMs`](../checks/events-and-metrics.md#dataSetCreationMs) |

#### Dashboard questions

The BetterStack dashboards should make it easy to answer:

- are `dataSetDeletionStatus{value="success"}` counts rising per provider on calibration?
- are `dataSetDeletionStatus{value="skipped.no_candidate"}` runs persisting longer than one creation interval, indicating `data_set_creation` is not replenishing?
- does `dataSetCreationStatus{value="success"}` follow `dataSetDeletionStatus{value="success"}` within the expected interval?
- are `dataSetCreationStatus{value="failure.*"}` counts rising after deletions, indicating a regression in `createDataSet`?

## Relationship to `data_set_creation`

The two jobs form a bounded loop.

`data_set_deletion` only deletes datasets that correspond to dealbot-managed metadata slots. `data_set_creation` detects the resulting `missing` slot through its normal metadata lookup and recreates it without needing any new cross-job state.

Expected healthy behavior:

1. `data_set_deletion` calls `terminateService` and polls until `pdpEndEpoch !== 0`.
2. `data_set_creation` runs next. The Synapse SDK filters the terminated dataset from metadata lookups, so the slot resolves as `missing` immediately — not `terminated`. `data_set_creation` provisions a replacement dataset directly in this run.
3. Existing creation metrics and alerts resume acting as the canary.

**Rate constraint:** `DATASET_CREATIONS_PER_SP_PER_HOUR` should be **greater than or equal to** `DATASET_DELETIONS_PER_SP_PER_HOUR`. If deletion runs faster than creation, the missing-slot backlog accumulates and the system stops behaving like a simple steady-state canary. The scheduler should emit a startup warning log when this constraint is violated so the misconfiguration is visible without a dashboard.

**Canary window size:** The number of slots eligible for deletion is `MIN_NUM_DATASETS_FOR_CHECKS - DATA_SET_DELETION_MIN_INDEX`. A canary window of `1` means a single slot cycles continuously; a larger window gives deletion more candidates when one slot has active deals blocking it. In practice, a window of `2`–`3` is usually enough buffer.

**Interaction with `piece_cleanup`:** Marking deal rows `cleaned_up = true` after a successful deletion removes those rows from `piece_cleanup`'s candidate pool (which filters on `cleaned_up = false`). This is correct behavior — the data was intentionally deleted, not just freed up for quota management. It also means a deletion-heavy configuration will naturally reduce the number of pieces available for quota-driven cleanup, which operators should account for when sizing `MAX_DATASET_STORAGE_SIZE_BYTES`.


## FAQ

### What happens on-chain after `terminateService` is called?

`terminateService` does not delete a dataset instantly. It starts a multi-step on-chain sequence that plays out over roughly 30 days. Understanding this is important because the deletion job only needs the first step to complete before it can exit and let `data_set_creation` replenish the slot.

**Step 1 — terminateService tx confirms**

`terminateService` calls `FilecoinPay.terminateRail(pdpRailId)`, which sets `endEpoch = block.number + lockupPeriod` on the PDP rail. The FWSS `railTerminated` callback fires in the same transaction, stores `info.pdpEndEpoch`, and emits `PDPPaymentsTerminated` and `ServiceTerminated`.

This is the point the deletion job polls for: `pdpEndEpoch !== 0`. Once this is set, `data_set_creation` will classify the slot as `missing` and begin the replenishment sequence. The deletion job's work is done here.

**Step 2 — rail finalization (~30 days later)**

When the PDP rail's `settledUpTo` reaches `endEpoch`, `finalizeTerminatedRail` fires atomically inside the same settle transaction. The rail is zeroed, `RailFinalized` is emitted, and any unused `lockupFixed` balance is returned to the payer.

**Step 3 — dataset deletion at PDPVerifier (SP-initiated, after step 2)**

After the rail finalizes, the storage provider calls `PDPVerifier.deleteDataSet`. This is an SP-only operation at the PDPVerifier layer. It clears the dataset's header state and invokes `FWSS.dataSetDeleted`, which verifies the rail has finalized and the lockup has elapsed before wiping FWSS-side state. Note that PDPVerifier's per-piece mappings are not cleared by this call.

**Why the deletion job only waits for step 1**

Step 2 happens when `settleRail` is called and the rail's `settledUpTo` reaches `endEpoch`. Step 3 requires the SP to call `PDPVerifier.deleteDataSet` after the rail finalizes. The deletion job does not need to wait for either — the slot is considered missing for dealbot's purposes as soon as `pdpEndEpoch !== 0` is set. Waiting for full finalization would mean waiting ~30 days per invocation, which defeats the purpose of a canary cycle.

## Source of truth

- Dataset creation design: [`docs/data-set-creation.md`](./data-set-creation.md)
- Job system overview: [`docs/jobs.md`](./jobs.md)
- Metrics and event definitions: [`docs/checks/events-and-metrics.md`](./checks/events-and-metrics.md)
- Scheduler and workers: [`apps/backend/src/jobs/jobs.service.ts`](../apps/backend/src/jobs/jobs.service.ts)
- Dataset creation handler: [`apps/backend/src/jobs/data-set-creation.handler.ts`](../apps/backend/src/jobs/data-set-creation.handler.ts)
- Deal service dataset logic: [`apps/backend/src/deal/deal.service.ts`](../apps/backend/src/deal/deal.service.ts)
- Piece cleanup reference: [`apps/backend/src/piece-cleanup/piece-cleanup.service.ts`](../apps/backend/src/piece-cleanup/piece-cleanup.service.ts)
