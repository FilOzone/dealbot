# Data Set Lifecycle Check

`data_set_lifecycle_check` is a calibration-focused canary job that, in a **single tick**,
creates a throwaway data set with a seed piece and immediately terminates it
(`terminateService`). It exists to continuously exercise the full on-chain
`createDataSet → terminateService` lifecycle so dealbot detects regressions in either path,
independent of how many managed check data sets a provider already has.

> **Note**: this job does **not** attempt `PDPVerifier.deleteDataSet`, which is SP-initiated.
> See the FAQ for what happens on-chain after `terminateService`.

## Summary

- Self-contained: one invocation **creates one data set and terminates it**. It does not
  touch the managed check data sets (slots `0..MIN_NUM_DATASETS_FOR_CHECKS-1`) and does not
  depend on `data_set_creation` to replenish anything.
- Runs on the shared `sp.work` queue with `singletonKey=spAddress`, so it cannot race with
  `deal`, `retrieval`, `piece_cleanup`, `pull_check`, or `data_set_creation` for the same provider.
- Schedule creation is gated by `DATASET_LIFECYCLE_CHECK_ENABLED` (default: true on
  calibration, false on mainnet).
- The throwaway data set carries a single fixed metadata marker key, `dealbotLifecycleCheck`,
  with a per-run nonce value. No base/slot metadata is attached.

## Why a single-tick create + terminate

The previous design terminated an existing managed slot and relied on `data_set_creation` to
recreate it on a later tick. That coupled the canary to `MIN_NUM_DATASETS_FOR_CHECKS`, a
min-index window, and the creation job's cadence. The lifecycle check collapses this into one
self-contained job: it always creates a fresh set and terminates it in the same run, so the
canary works regardless of provider state and needs no cross-job coordination.

### Trade-off: leakage

If creation succeeds but termination fails (process crash, job timeout, on-chain revert that
isn't an already-terminated no-op), the created data set **leaks** — it stays live on the SP.
This is an accepted trade-off for the job's simplicity.

Because every set created by this job carries the fixed `dealbotLifecycleCheck` metadata key,
leaked sets are discoverable and can be swept manually (filter datasets by that metadata key).
If leakage grows significantly, that is the handle to clean up by. The
`dataset_lifecycle_check_failed` log line with `leakedDataSet: true` records the `dataSetId`
of each leak when it happens.

## Configuration

- [`DATASET_LIFECYCLE_CHECK_ENABLED`](../environment-variables.md#dataset_lifecycle_check_enabled)
  — enables the job. Defaults to true on calibration, false on mainnet. When disabled, stale
  schedules are removed so they stop enqueuing no-op jobs.
- [`DATASET_LIFECYCLE_CHECKS_PER_SP_PER_HOUR`](../environment-variables.md#dataset_lifecycle_checks_per_sp_per_hour)
  — rate per provider, converted internally to `intervalSeconds`. Independent of
  `DATASET_CREATIONS_PER_SP_PER_HOUR`.
- [`DATA_SET_LIFECYCLE_CHECK_JOB_TIMEOUT_SECONDS`](../environment-variables.md#data_set_lifecycle_check_job_timeout_seconds)
  — max runtime for one invocation. Bounds the seed-piece upload, the `terminateService`
  call, and the `pdpEndEpoch != 0` confirmation poll. Default `600`.

## Handler algorithm

For one provider, one invocation of `data_set_lifecycle_check`:

1. Apply the same maintenance-window and SP-blocklist rules used by other SP jobs.
2. If `DATASET_LIFECYCLE_CHECK_ENABLED` is false, log a disabled skip and exit (defensive gate
   for stale enqueued jobs).
3. Build metadata `{ dealbotLifecycleCheck: "<timestamp>-<jobId>" }`. The fixed key is the
   manual-cleanup handle; the per-run nonce value forces `createContext` to provision a fresh
   set instead of resolving a prior (possibly leaked) set.
4. Create an `AbortController` from `DATA_SET_LIFECYCLE_CHECK_JOB_TIMEOUT_SECONDS`.
5. Call `DealService.runDataSetLifecycleCheck(spAddress, metadata, signal, timeoutMs)`, which:
   - a. Creates the data set with a 200 KiB seed piece (metrics-free; **no** `dataSetCreation`
     metrics — those belong to `data_set_creation`).
   - b. Calls `terminateService` on the created `dataSetId` and polls until FWSS confirms
     `pdpEndEpoch != 0`.
   - c. Records `dataSetLifecycleCheckStatus` / `dataSetLifecycleCheckMs`.

### Idempotency / abort handling

- An abort (job timeout) or internal poll timeout is classified as `failure.timedout`;
  pg-boss does not retry (failures are handled by the next scheduled tick).
- The terminate step tolerates an already-terminated revert as a no-op and continues polling.

## Metrics

All metrics carry the standard label set (`checkType`, `providerId`, `providerName`,
`providerStatus`) with `checkType=dataSetLifecycleCheck`. See
[`events-and-metrics.md`](./events-and-metrics.md).

| Metric | `value` labels | What to watch for |
|--------|---------------|-------------------|
| [`dataSetLifecycleCheckStatus`](./events-and-metrics.md#dataSetLifecycleCheckStatus) | `success`, `failure.timedout`, `failure.other` | `success` per provider confirms the full create→terminate lifecycle works on calibration; persistent `failure.*` indicates a `createDataSet` or `terminateService` regression |
| [`dataSetLifecycleCheckMs`](./events-and-metrics.md#dataSetLifecycleCheckMs) | — | End-to-end duration (create + upload + terminate + confirm); emitted on `success` and `failure.timedout` only |

## FAQ

### What happens on-chain after `terminateService` is called?

`terminateService` does not delete a dataset instantly. It starts a multi-step on-chain
sequence that plays out over roughly 30 days. The lifecycle check only needs the first step to
complete before it exits.

**Step 1 — terminateService tx confirms.** `terminateService` calls
`FilecoinPay.terminateRail(pdpRailId)`, which sets `endEpoch = block.number + lockupPeriod` on
the PDP rail. The FWSS `railTerminated` callback fires in the same transaction, stores
`info.pdpEndEpoch`, and emits `PDPPaymentsTerminated` and `ServiceTerminated`. This is the
point the job polls for: `pdpEndEpoch != 0`.

**Step 2 — rail finalization (~30 days later).** When the PDP rail's `settledUpTo` reaches
`endEpoch`, `finalizeTerminatedRail` fires atomically inside the settle transaction.

**Step 3 — dataset deletion at PDPVerifier (SP-initiated).** After the rail finalizes, the SP
may call `PDPVerifier.deleteDataSet`. The lifecycle check does not wait for steps 2 or 3 —
waiting ~30 days per invocation would defeat the purpose of a canary cycle.

## Source of truth

- Dataset creation design: [`docs/data-set-creation.md`](../data-set-creation.md)
- Job system overview: [`docs/jobs.md`](../jobs.md)
- Metrics and event definitions: [`docs/checks/events-and-metrics.md`](./events-and-metrics.md)
- Scheduler and workers: [`apps/backend/src/jobs/jobs.service.ts`](../../apps/backend/src/jobs/jobs.service.ts)
- Deal service dataset logic (`createDataSetWithPiece`, `runDataSetLifecycleCheck`): [`apps/backend/src/deal/deal.service.ts`](../../apps/backend/src/deal/deal.service.ts)
