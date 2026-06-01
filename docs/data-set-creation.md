# Data Set Creation Job

This doc explains the design of the `data_set_creation` job: why it exists, how dealbot schedules it, how each run decides what to do, and how it interacts with on-chain dataset state.

## Summary

- `data_set_creation` was originally added so dealbot could maintain enough datasets per provider for data-retention sampling and FWSS approval evaluation.
- It now also serves as the repair path for terminated datasets that are still resolved by metadata but are no longer live.
- Operationally, it ensures each active storage provider has at least `MIN_NUM_DATASETS_FOR_CHECKS` live datasets available for checks.
- The scheduler creates one `job_schedule_state` row per `<sp_address, data_set_creation>` when `MIN_NUM_DATASETS_FOR_CHECKS >= 1`.
- Each run inspects dataset slots in order and handles **at most one** non-live slot per invocation.
- Missing datasets are provisioned by uploading a minimal seed piece.
- Terminated datasets are repaired first; replacement is deferred to a later run.
- The job runs on the shared `sp.work` queue with the same per-SP singleton behavior as `deal`, `retrieval`, `piece_cleanup`, and `pull_check`.

## Why it was added and why it still matters

This job was originally added so dealbot could maintain enough datasets per provider for `data_retention` to accumulate enough samples to evaluate FWSS approval criteria. In practice, raising `MIN_NUM_DATASETS_FOR_CHECKS` increases the number of datasets per provider, which increases on-chain proof samples for the data retention check.

That original motivation is different from the job's current operational role. Today, `data_set_creation` is also the repair path for terminated datasets that still resolve via metadata in `createContext(...)` but are no longer usable because they are suffering unrecoverable proving failures on the SP side.

Those terminated datasets are often first surfaced by the `deal` job. When that happens, `deal` does not repair them inline; it defers repair to `data_set_creation`, which then reconciles the slot incrementally.

This job remains intentionally separate from `deal`:

- `deal` focuses on running a data-storage check and may detect a terminated dataset.
- `data_set_creation` focuses on maintaining dataset inventory over time and repairing terminated slots.
- Keeping the repair path separate avoids mixing normal check execution with dataset lifecycle recovery.

## Scheduling and queueing

The scheduler creates per-provider `data_set_creation` schedules in the same loop that upserts `deal` and `retrieval` schedules.

- Schedule creation is gated by `MIN_NUM_DATASETS_FOR_CHECKS >= 1`.
- The interval is derived from `DATASET_CREATIONS_PER_SP_PER_HOUR`.
- The initial `next_run_at` uses the same phase offset logic as other SP jobs.
- Enqueued jobs use payload `{ jobType: 'data_set_creation', spAddress, intervalSeconds }`.
- Jobs go to the shared `sp.work` pg-boss queue.
- The queue send path assigns `singletonKey=spAddress`, so only one SP-scoped job can be active for a provider at a time across all workers.

That singleton behavior is important because `data_set_creation` mutates provider dataset state and should not race with the provider's other scheduled jobs.

## Preconditions and skip conditions

Before the handler does any provisioning work, it applies the same operational guards used by other SP-scoped jobs:

- **Maintenance windows**: if a maintenance window is active, the job is deferred instead of running.
- **SP blocklists**: if the provider is blocked by configured blocklists, the job logs a skip and exits.
- **Timeouts**: the handler runs under an `AbortController` timeout based on `DATA_SET_CREATION_JOB_TIMEOUT_SECONDS`, with an effective floor of 120 seconds.

## Dataset slot model

The job treats required datasets as numbered slots from `0` to `MIN_NUM_DATASETS_FOR_CHECKS - 1`.

For each slot, it computes deterministic metadata:

- Base metadata comes from `DealService.getBaseDataSetMetadata()`.
- Base metadata always includes the IPNI metadata key (`withIpniIndexing=""`).
- If `DEALBOT_DATASET_VERSION` is configured, base metadata also includes `dealbotDataSetVersion`.
- Slot `0` uses only the base metadata.
- Slots `1+` add `dealbotDS: String(index)`.

This makes each slot addressable and idempotent: repeated runs look up the same logical dataset slot using the same metadata.

## Handler algorithm

For one provider, one invocation of `data_set_creation` works like this:

1. Resolve the provider context and verify the provider is runnable.
2. Read `MIN_NUM_DATASETS_FOR_CHECKS` and the base dataset metadata.
3. Iterate slots from `0` upward.
4. For each slot, call `DealService.getDataSetProvisioningStatus(spAddress, metadata, signal)`.
5. If the slot is `live`, continue to the next slot.
6. If the slot is `terminated`, repair it and stop for this tick.
7. If the slot is `missing`, create it and stop for this tick.
8. If every slot is `live`, log completion and exit.

The key design choice is **incremental provisioning**: one run repairs or creates at most one slot. That keeps runtime bounded and spreads background load across scheduler ticks instead of attempting a full reconciliation in one execution.

## How slot status is determined

`DealService.getDataSetProvisioningStatus()` classifies a slot as `missing`, `live`, or `terminated`.

The lookup flow is:

1. Resolve provider info from the wallet/registry layer.
2. Call Synapse `storage.createContext({ providerId, metadata })`.
3. If no `dataSetId` is present in the context, the slot is `missing`.
4. If a `dataSetId` is present, probe liveness through `DatasetLivenessService`.
5. Return `live` if the probes succeed, otherwise return `terminated`.

`terminated` means the dataset identifier still resolves from metadata, but liveness checks say the dataset is no longer usable.

## Missing dataset flow

When the first missing slot is found, the job provisions exactly one dataset by calling `DealService.createDataSetWithPiece()`.

That method:

- Resolves the provider from the registry.
- Creates the dataset using the same `createContext + executeUpload` path used by data-storage checks.
- Uploads a minimal seed piece so the dataset is non-empty.
- Does **not** persist a `Deal` row.
- Does **not** emit data-storage-check success or failure metrics.
- Does **not** perform retrieval checks or IPNI verification steps after upload.

The goal is only to ensure the dataset exists and can later be used by the real checks.

## Terminated dataset repair flow

When the first terminated slot is found, the job calls `DealService.repairTerminatedDataSet()` and then exits without creating a replacement in the same run.

Repair is intentionally idempotent:

1. Read the FWSS dataset state.
2. If `pdpEndEpoch` is already non-zero, skip the terminate transaction.
3. Otherwise call `terminateDataSet`.
4. Wait for the transaction receipt when possible.
5. Poll FWSS until `pdpEndEpoch != 0`.
6. Mark existing `Deal` rows for that `dataSetId` as `cleanedUp=true` in one transaction.

After that repair completes, the next scheduled run will see the slot as `missing` and provision a replacement dataset.

This two-step approach avoids mixing termination cleanup and replacement provisioning into one long, failure-prone handler execution.

## Interaction with other jobs

- `deal` depends on these datasets being available.
- If a `deal` job hits a terminated dataset, it logs that the dataset is PDP-terminated and waits for `data_set_creation` repair.
- Because all SP-scoped jobs share the same singleton queue key, `data_set_creation` cannot overlap with the same provider's `deal`, `retrieval`, `piece_cleanup`, or `pull_check` job.

## Configuration

The main controls for this job are:

- `MIN_NUM_DATASETS_FOR_CHECKS`: required number of live dataset slots per provider.
- [`DATASET_CREATIONS_PER_SP_PER_HOUR`](./environment-variables.md#dataset_creations_per_sp_per_hour): scheduling rate for reconciliation runs.
- `DATA_SET_CREATION_JOB_TIMEOUT_SECONDS`: job timeout before the abort signal fires.
- [`DEALBOT_DATASET_VERSION`](./environment-variables.md#dealbot_dataset_version): optional version tag added to base dataset metadata.
- `USE_ONLY_APPROVED_PROVIDERS`: indirectly affects which providers receive schedules.

## Observability

The job is observable in two layers:

- **Structured logs** for provisioning, repair, aborts, failures, maintenance deferrals, and completed reconciliation.
- **Generic job metrics** through the shared Prometheus job counters and duration histogram (`jobs_started_total`, `jobs_completed_total`, `job_duration_seconds`).

Common log events include:

- `creating_provisioned_data_set`
- `data_set_provisioning_progress`
- `data_sets_provisioning_completed`
- `dataset_terminated_detected`
- `data_set_repair_completed`
- `data_set_creation_job_aborted`
- `data_set_creation_job_failed`

## Source of truth

- Scheduler and handler: [`apps/backend/src/jobs/jobs.service.ts`](../apps/backend/src/jobs/jobs.service.ts)
- Incremental provisioning logic: [`apps/backend/src/jobs/data-set-creation.handler.ts`](../apps/backend/src/jobs/data-set-creation.handler.ts)
- Dataset provisioning and repair: [`apps/backend/src/deal/deal.service.ts`](../apps/backend/src/deal/deal.service.ts)
- Job system overview: [`docs/jobs.md`](./jobs.md)
