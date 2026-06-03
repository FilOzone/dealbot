# Data Set Termination Job

This doc proposes a calibration-only `data_set_termination` job that periodically terminates a dealbot managed dataset so the existing `data_set_creation` job naturally recreates it. The goal is to keep dealbot continuously exercising the on-chain `createDataSet` lifecycle instead of only creating datasets until a steady-state cap is reached.

> **Note**: this design does **not** attempt `PDPVerifier.deleteDataSet`, which is SP-initiated; if `deleteDataSet` canary coverage is required for #586, that would need a different approach.

## Summary

- `data_set_termination` is a calibration-only job that periodically terminates one managed dataset slot per provider.
- Together with [`data_set_creation`](./data-set-creation.md), the two jobs form a bounded loop that keeps the `createDataSet` on-chain path continuously exercised as a canary.
- The job terminates **at most one dataset per invocation**; `data_set_creation` handles replenishment on its next scheduled tick.
- It runs on the shared `sp.work` queue with `singletonKey=spAddress`, so it cannot race with `deal`, `retrieval`, `piece_cleanup`, `pull_check`, or `data_set_creation` for the same provider.
- Schedule creation is gated by `NETWORK=calibration` and a non-empty canary window (`MIN_NUM_DATASETS_FOR_CHECKS - DATA_SET_TERMINATION_MIN_INDEX > 0`).
- Slots below `DATA_SET_TERMINATION_MIN_INDEX` are never touched, keeping a stable baseline for ongoing checks.

## Problem Context

During the PDPVerifier v3.4.0 rollout, `createDataSet` broke on calibration and mainnet. Dealbot did not detect the calibration outage because providers had already reached the steady-state cap of managed datasets ([`MIN_NUM_DATASETS_FOR_CHECKS`](./environment-variables.md#min_num_datasets_for_checks)). Once the cap was reached, `data_set_creation` stopped exercising the on-chain create path, so the canary value of that job disappeared.

The missing capability is not more creation logic. The missing capability is a controlled way to create fresh demand for creation again.

## Goals

- Continuously exercise the calibration `createDataSet → terminateService → createDataSet` lifecycle.
- Reuse the existing `data_set_creation` job as the replenishment mechanism.
- Minimize disruption to ongoing deal and retrieval checks.
- Make termination cadence explicitly configurable so the expected create cadence can be reasoned about.
- Ensure the job cannot run on mainnet.
- Expose enough metrics and logs to extend the existing BetterStack dashboards.

## Proposed job

Introduce a new SP-scoped job type: `data_set_termination`.

The job should:

- run only on calibration
- run on a configurable cadence
- terminate at most one safe managed dataset per provider per invocation
- rely on the existing `data_set_creation` job to recreate the missing slot on a later tick

This keeps termination simple and keeps creation logic centralized in the existing job.

### Configuration

The initial design adds these controls, which follow the same naming pattern as the creation job:

- `DATASET_TERMINATIONS_PER_SP_PER_HOUR`
  - mirrors the existing rate-based job controls
  - converted internally to `intervalSeconds`
  - used to reason about expected termination frequency

- `DATA_SET_TERMINATION_JOB_TIMEOUT_SECONDS`
  - max runtime for one termination job invocation

- `DATA_SET_TERMINATION_MIN_INDEX`
  - the lowest slot index eligible for termination (inclusive)
  - default: `1` — only the baseline slot (index `0`) is protected
  - slots `0` through `DATA_SET_TERMINATION_MIN_INDEX - 1` are never touched by this job
  - example: `MIN_NUM_DATASETS_FOR_CHECKS = 10`, `DATA_SET_TERMINATION_MIN_INDEX = 5` → slots 0–4 are stable, slots 5–9 cycle as the canary window
  - set to `MIN_NUM_DATASETS_FOR_CHECKS` to disable termination entirely — the canary window becomes empty and no schedule is created
  - must be `>= 1` and `<=` [`MIN_NUM_DATASETS_FOR_CHECKS`](./environment-variables.md#min_num_datasets_for_checks); violating either constraint crashes the application on startup

### Scheduling and queueing

The scheduling model mirrors `data_set_creation`:

- queue: shared `sp.work`
- `singletonKey=spAddress`

Sharing the singleton with other SP jobs prevents termination from racing with a `deal`, `retrieval`, `pull_check`, `piece_cleanup`, or `data_set_creation` job for the same provider.

The schedule is only upserted when all of the following are true:

- `NETWORK=calibration`
- `MIN_NUM_DATASETS_FOR_CHECKS - DATA_SET_TERMINATION_MIN_INDEX > 0`

The second condition covers the `DATA_SET_TERMINATION_MIN_INDEX = MIN_NUM_DATASETS_FOR_CHECKS` case (empty canary window, termination effectively off) without crashing. It also handles the case where `MIN_NUM_DATASETS_FOR_CHECKS` is later lowered to meet `DATA_SET_TERMINATION_MIN_INDEX` — no schedule is created without requiring a config change.

### Proposed handler algorithm

For one provider, one invocation of `data_set_termination` works like this:

1. Check that the network is calibration. If not, log skip and exit.
2. Apply the same maintenance-window and SP-blocklist rules used by other SP jobs.
3. Create an `AbortController` using `DATA_SET_TERMINATION_JOB_TIMEOUT_SECONDS`.
4. Read `MIN_NUM_DATASETS_FOR_CHECKS` and base dataset metadata.
5. Scan slots from `minDataSets - 1` down to `DATA_SET_TERMINATION_MIN_INDEX`. For each slot:
   - a. Build its metadata using the same logic as `data_set_creation`.
   - b. Classify it via `getDataSetProvisioningStatus()`.
   - c. Skip if `missing` — nothing to terminate.
   - d. Skip if `terminated` — `data_set_creation` owns repair of these slots.
   - e. Skip if `live` but has any deal row with `cleaned_up = false` — the deal job is still tracking it as active.
6. Call the termination flow on the first slot that passes all skip conditions (reaches step 5e without being skipped).
7. Log the outcome and exit for this tick.
8. If no eligible slot is found after the full scan, log `skipped.no_candidate` and exit. This is expected when `data_set_creation` has not yet replenished a previously terminated slot.

As with `data_set_creation`, the job performs **at most one state-changing action per invocation**.

### Proposed termination flow

The termination flow should be implemented in a dedicated service method rather than inline in `JobsService`.

1. Resolve provider info from cache and the target `dataSetId` using synapse-sdk by building slot dataset metadata.
2. Call the on-chain `terminateService` path through Synapse (`await synapse.storage.terminateDataSet({ dataSetId })`).
3. Wait for transaction receipt.
4. Poll until `pdpEndEpoch !== 0`. A live dataset has `pdpEndEpoch === 0`; once `terminateService` confirms, `pdpEndEpoch !== 0` is set on-chain. The Synapse SDK filters datasets with `pdpEndEpoch !== 0` from metadata lookups, so `getDataSetProvisioningStatus()` will return `missing` for this slot from this point on.
5. Once `pdpEndEpoch !== 0` is observed, the termination flow's work is done. `data_set_creation` will see the slot as `missing` on its next run and provision a replacement directly.

Polling until the chain confirms termination is important because the canary value comes from the full on-chain lifecycle, not just submitting a transaction.

#### Idempotency

The termination flow must tolerate races and retries:

- If `pdpEndEpoch !== 0` is already set when the job starts (slot is already terminated), skip the `terminateService` call and treat the run as a no-op success.
- If `terminateService` reverts with an already-terminated error (for example, `"service already terminated"` or `"dataset not active"`), treat it as idempotent success and proceed to the polling step.
- If the transaction confirms but `pdpEndEpoch` does not become non-zero before the abort signal fires, treat the run as `failure.timedout` and let pg-boss retry on the next tick.

### Metrics and BetterStack dashboards

The termination job has two distinct observability concerns: is the trigger firing, and is the canary signal it produces showing up in creation metrics. Creation metrics are the primary signal; termination metrics are only there to confirm the trigger is working.

All metrics carry the standard label set defined in [`checks/events-and-metrics.md`](./checks/events-and-metrics.md#metrics):
`checkType`, `providerId`, `providerName`, `providerStatus`.

For termination metrics, `checkType=dataSetTermination`. For creation metrics referenced below, `checkType=dataSetCreation`.

#### Creation metrics (primary signal)

These already exist and are defined in [`events-and-metrics.md`](./checks/events-and-metrics.md). `data_set_termination` creates the conditions for them to fire — if they stay silent after termination is running, something is wrong with creation.

| Metric | `value` labels | What to watch for |
|--------|---------------|-------------------|
| [`dataSetCreationStatus`](./checks/events-and-metrics.md#dataSetCreationStatus) | `pending`, `success`, `failure.timedout`, `failure.other` | `success` count should rise in the interval after each termination; persistent `failure.*` after a termination indicates a `createDataSet` regression |
| [`dataSetCreationMs`](./checks/events-and-metrics.md#dataSetCreationMs) | — | Latency histogram for `createDataSetWithPiece`; spikes after termination may indicate on-chain congestion |

#### Termination metrics (trigger health)

New metrics proposed here. These confirm termination is producing the conditions for creation to run. If termination metrics look healthy but creation metrics are silent, the loop is broken somewhere between the two jobs.

| Metric | `value` labels | What to watch for |
|--------|---------------|-------------------|
| `dataSetTerminationStatus` | `success`, `failure.timedout`, `failure.other`, `skipped.no_candidate` | `success` per provider confirms the trigger is firing; persistent `skipped.no_candidate` means `data_set_creation` is not replenishing fast enough |
| `dataSetTerminationMs` | — | Histogram from `terminateService` call to `pdpEndEpoch !== 0` confirmed; emitted on `success` and `failure.timedout` only. Analogous to `dataSetCreationMs` |

#### Dashboard questions

The BetterStack dashboards should make it easy to answer:

- are `dataSetTerminationStatus{value="success"}` counts rising per provider on calibration?
- are `dataSetTerminationStatus{value="skipped.no_candidate"}` runs persisting longer than one creation interval, indicating `data_set_creation` is not replenishing?
- does `dataSetCreationStatus{value="success"}` follow `dataSetTerminationStatus{value="success"}` within the expected interval?
- are `dataSetCreationStatus{value="failure.*"}` counts rising after terminations, indicating a regression in `createDataSet`?

## Relationship to `data_set_creation`

The two jobs form a bounded loop.

`data_set_termination` only terminates datasets that correspond to dealbot-managed metadata slots. `data_set_creation` detects the resulting `missing` slot through its normal metadata lookup and recreates it without needing any new cross-job state.

Expected healthy behavior:

1. `data_set_termination` calls `terminateService` and polls until `pdpEndEpoch !== 0`.
2. `data_set_creation` runs next. The Synapse SDK filters the terminated dataset from metadata lookups, so the slot resolves as `missing` immediately. `data_set_creation` provisions a replacement dataset directly in this run.
3. Existing creation metrics and alerts resume acting as the canary.

**Rate constraint:** `DATASET_CREATIONS_PER_SP_PER_HOUR` should be **greater than or equal to** `DATASET_TERMINATIONS_PER_SP_PER_HOUR`. If termination runs faster than creation, the missing-slot backlog accumulates and the system stops behaving like a simple steady-state canary. The scheduler should emit a startup warning log when this constraint is violated so the misconfiguration is visible without a dashboard.

**Canary window size:** The number of slots eligible for termination is `MIN_NUM_DATASETS_FOR_CHECKS - DATA_SET_TERMINATION_MIN_INDEX`. A canary window of `1` means a single slot cycles continuously; a larger window gives termination more candidates when one slot has active deals blocking it. In practice, a window of `2`–`3` is usually enough buffer.

## Open Questions

### Should `terminated` be renamed in `getDataSetProvisioningStatus`?

The `terminated` status returned by `getDataSetProvisioningStatus` means: the Synapse SDK resolved a `dataSetId` from the metadata fingerprint but liveness probes failed. This is distinct from a dataset that has `pdpEndEpoch !== 0` on-chain (which the SDK filters out entirely, causing the slot to resolve as `missing`).

The name `terminated` is already used for both the on-chain lifecycle concept and this SDK liveness-probe failure state, which causes confusion. Candidate replacements: `irrecoverable` or `missing.sp`. This rename would affect `data_set_creation`'s handler and repair path as well.

### Should `data_set_termination` absorb the repair path from `data_set_creation`?

Currently, `data_set_creation` owns two distinct responsibilities:
1. Repairing `terminated` slots (liveness-probe failures) via `repairTerminatedDataSet`.
2. Provisioning `missing` slots via `createDataSetWithPiece`.

Once `data_set_termination` exists and calls `terminateService` directly, it handles on-chain termination for managed slots. The question is whether `data_set_creation` should be simplified to only own replenishment, with all termination (including repair) moving to `data_set_termination`. This is left open pending implementation experience.


## FAQ

### What happens on-chain after `terminateService` is called?

`terminateService` does not delete a dataset instantly. It starts a multi-step on-chain sequence that plays out over roughly 30 days. Understanding this is important because the termination job only needs the first step to complete before it can exit and let `data_set_creation` replenish the slot.

**Step 1 — terminateService tx confirms**

`terminateService` calls `FilecoinPay.terminateRail(pdpRailId)`, which sets `endEpoch = block.number + lockupPeriod` on the PDP rail. The FWSS `railTerminated` callback fires in the same transaction, stores `info.pdpEndEpoch`, and emits `PDPPaymentsTerminated` and `ServiceTerminated`.

This is the point the termination job polls for: `pdpEndEpoch !== 0`. Once this is set, `data_set_creation` will classify the slot as `missing` and begin the replenishment sequence. The termination job's work is done here.

**Step 2 — rail finalization (~30 days later)**

When the PDP rail's `settledUpTo` reaches `endEpoch`, `finalizeTerminatedRail` fires atomically inside the same settle transaction. The rail is zeroed, `RailFinalized` is emitted, and any unused `lockupFixed` balance is returned to the payer.

**Step 3 — dataset deletion at PDPVerifier (SP-initiated, after step 2)**

After the rail finalizes, the storage provider calls `PDPVerifier.deleteDataSet`. This is an SP-only operation at the PDPVerifier layer. It clears the dataset's header state and invokes `FWSS.dataSetDeleted`, which verifies the rail has finalized and the lockup has elapsed before wiping FWSS-side state. Note that PDPVerifier's per-piece mappings are not cleared by this call.

**Why the termination job only waits for step 1**

Step 2 happens when `settleRail` is called and the rail's `settledUpTo` reaches `endEpoch`. Step 3 requires the SP to call `PDPVerifier.deleteDataSet` after the rail finalizes. The termination job does not need to wait for either — the slot is considered missing for dealbot's purposes as soon as `pdpEndEpoch !== 0` is set. Waiting for full finalization would mean waiting ~30 days per invocation, which defeats the purpose of a canary cycle.

## Source of truth

- Dataset creation design: [`docs/data-set-creation.md`](./data-set-creation.md)
- Job system overview: [`docs/jobs.md`](./jobs.md)
- Metrics and event definitions: [`docs/checks/events-and-metrics.md`](./checks/events-and-metrics.md)
- Scheduler and workers: [`apps/backend/src/jobs/jobs.service.ts`](../apps/backend/src/jobs/jobs.service.ts)
- Dataset creation handler: [`apps/backend/src/jobs/data-set-creation.handler.ts`](../apps/backend/src/jobs/data-set-creation.handler.ts)
- Deal service dataset logic (including `getDataSetProvisioningStatus`, `repairTerminatedDataSet`): [`apps/backend/src/deal/deal.service.ts`](../apps/backend/src/deal/deal.service.ts)
