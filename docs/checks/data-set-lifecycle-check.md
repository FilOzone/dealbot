# Data Set Lifecycle Check

This document is the **source of truth** for how dealbot's Data Set Lifecycle check works.

Source code links throughout this document point to the current implementation.

For event and metric definitions used by the dashboard, see [Dealbot Events & Metrics](./events-and-metrics.md).

> **Note**: This check calls `terminateService` to start the on-chain termination sequence. It does **not** call `PDPVerifier.deleteDataSet`, which is SP-initiated. See the [FAQ](#what-happens-on-chain-after-terminateservice-is-called) for details on what happens after termination.

## Overview

A "data set lifecycle check" tests the full `createDataSet → terminateService` lifecycle for a storage provider. Each tick a coin-flip selects one of two data set creation path variants, then immediately terminates the throwaway data set. Running one variant per tick keeps the per-tick on-chain transaction cost identical to a single-check budget while covering both code paths over time.

**Empty variant** (50% of ticks): exercises the `createDataSet` path.
1. Creates a new empty data set, tagged with `dealbotLifecycleCheck` metadata
2. Waits for the SP to confirm the data set on-chain (`dataSetId` returned)
3. Calls `terminateService` on the created data set and waits for the transaction receipt

**With-pieces variant** (50% of ticks): exercises the `createDataSetAndAddPieces` path.
1. Uploads a small deterministic canary piece to the SP's HTTP storage service
2. Polls until the SP confirms it has ingested the piece (`findPiece` with retry)
3. Atomically creates a data set and registers the piece on-chain
4. Waits for the SP to confirm both data set creation and piece addition
5. Calls `terminateService` on the created data set and waits for the transaction receipt

A successful check requires all steps of whichever variant runs to complete within the allowed time. Failure occurs if any step fails or the check exceeds `DATA_SET_LIFECYCLE_CHECK_JOB_TIMEOUT_SECONDS`.

The two variants emit metrics under distinct `checkType` labels (`dataSetLifecycleCheck` and `dataSetWithPiecesLifecycleCheck`) so dashboards can track them independently.

## What Gets Asserted

Each data set lifecycle check asserts the following for every SP. Assertions 1–3 apply to the empty variant; assertions 1′–5′ apply to the with-pieces variant. Both paths share the timeout assertion.

**Empty variant assertions:**

| # | Assertion | How It's Checked | Relevant Metric |
|---|-----------|-----------------|-----------------|
| 1 | SP accepts an empty data set creation | `createDataSet` call completes and the SP returns a `statusUrl` | [`dataSetLifecycleCheckStatus`](./events-and-metrics.md#dataSetLifecycleCheckStatus) |
| 2 | Data set is confirmed on-chain | `waitForCreateDataSet` resolves with a `dataSetId` | [`dataSetLifecycleCheckStatus`](./events-and-metrics.md#dataSetLifecycleCheckStatus) |
| 3 | `terminateService` succeeds on the created data set | `terminateServiceSync` call completes and the transaction receipt is received | [`dataSetLifecycleCheckMs`](./events-and-metrics.md#dataSetLifecycleCheckMs) |
| 4 | All steps complete within the timeout | Check is not marked successful until all steps pass within `DATA_SET_LIFECYCLE_CHECK_JOB_TIMEOUT_SECONDS` | [`dataSetLifecycleCheckMs`](./events-and-metrics.md#dataSetLifecycleCheckMs) |

**With-pieces variant assertions:**

| # | Assertion | How It's Checked | Relevant Metric |
|---|-----------|-----------------|-----------------|
| 1′ | SP accepts the canary piece upload | `uploadPieceStreaming` completes and returns a `pieceCid` | [`dataSetWithPiecesLifecycleCheckStatus`](./events-and-metrics.md#dataSetWithPiecesLifecycleCheckStatus) |
| 2′ | SP confirms piece ingestion | `findPiece` (with retry) resolves, confirming the SP has the data before the on-chain call | [`dataSetWithPiecesLifecycleCheckStatus`](./events-and-metrics.md#dataSetWithPiecesLifecycleCheckStatus) |
| 3′ | SP accepts atomic data set + piece creation | `createDataSetAndAddPieces` call completes and the SP returns a `statusUrl` | [`dataSetWithPiecesLifecycleCheckStatus`](./events-and-metrics.md#dataSetWithPiecesLifecycleCheckStatus) |
| 4′ | Data set and piece are confirmed on-chain | `waitForCreateDataSetAddPieces` resolves with a `dataSetId` and `piecesIds` | [`dataSetWithPiecesLifecycleCheckStatus`](./events-and-metrics.md#dataSetWithPiecesLifecycleCheckStatus) |
| 5′ | `terminateService` succeeds on the created data set | `terminateServiceSync` call completes and the transaction receipt is received | [`dataSetWithPiecesLifecycleCheckMs`](./events-and-metrics.md#dataSetWithPiecesLifecycleCheckMs) |
| 6′ | All steps complete within the timeout | Check is not marked successful until all steps pass within `DATA_SET_LIFECYCLE_CHECK_JOB_TIMEOUT_SECONDS` | [`dataSetWithPiecesLifecycleCheckMs`](./events-and-metrics.md#dataSetWithPiecesLifecycleCheckMs) |

## Data Set Lifecycle Check Lifecycle

The dealbot scheduler triggers data set lifecycle check jobs at a configurable rate. On each tick, a coin-flip (`Math.random() < 0.5`) selects which creation variant to run — never both.

```mermaid
flowchart TD
  Start["Job starts"] --> Guard["Apply job guards"]
  Guard -->|disabled| Skip["Log skip and exit"]
  Guard -->|enabled| CoinFlip{"coin-flip\nMath.random()"}

  CoinFlip -->|"< 0.5 (empty variant)"| CreateDataSet["createDataSet"]
  CreateDataSet --> WaitEmpty["waitForCreateDataSet"]
  WaitEmpty -->|dataSetId confirmed| TerminateE["terminateServiceSync"]
  TerminateE -->|tx receipt received| SuccessE["Record success\n(dataSetLifecycleCheck)"]
  TerminateE -->|error| FailE["Record failure\n(dataSetLifecycleCheck)"]
  WaitEmpty -->|error| FailE
  CreateDataSet -->|error| FailE

  CoinFlip -->|">= 0.5 (with-pieces variant)"| Upload["uploadPieceStreaming"]
  Upload --> FindPiece["findPiece (retry)"]
  FindPiece --> CreateWithPieces["createDataSetAndAddPieces"]
  CreateWithPieces --> WaitPieces["waitForCreateDataSetAddPieces"]
  WaitPieces -->|dataSetId + piecesIds confirmed| TerminateW["terminateServiceSync"]
  TerminateW -->|tx receipt received| SuccessW["Record success\n(dataSetWithPiecesLifecycleCheck)"]
  TerminateW -->|error| FailW["Record failure\n(dataSetWithPiecesLifecycleCheck)"]
  WaitPieces -->|error| FailW
  CreateWithPieces -->|error| FailW
  FindPiece -->|error| FailW
  Upload -->|error| FailW
```

### 1. Apply job guards

Dealbot applies the same maintenance-window and SP-blocklist rules used by all other SP jobs. If `DATASET_LIFECYCLE_CHECK_ENABLED` is `false`, the job logs a disabled skip and exits.

### 2. Select variant (coin-flip)

`Math.random() < 0.5` → empty variant; `>= 0.5` → with-pieces variant. Exactly one variant runs per tick. See [Why two variants?](#why-two-variants) for the rationale.

Source: [`data-set-lifecycle.service.ts` (`runLifecycleCheck`)](../../apps/backend/src/data-set-lifecycle/data-set-lifecycle.service.ts)

### 3. Empty variant: exercise `createDataSet` path

### 3a. Create the empty data set

Dealbot calls `createDataSet` (from `@filoz/synapse-core/sp`) to create a new empty data set on the SP. The data set is tagged with metadata `{ dealbotLifecycleCheck: "<timestamp>" }`. The fixed `dealbotLifecycleCheck` key is the handle for finding leaked sets later; the per-run timestamp ensures a fresh data set is created on every invocation.

This step does **not** emit `dataSetCreation` metrics — those belong to the [`data_set_creation`](../data-set-creation.md) job.

### 3b. Wait for data set creation confirmation

Dealbot calls `waitForCreateDataSet` with the `statusUrl` returned by the SP. When the SP confirms the data set is created on-chain, it resolves with a `dataSetId`.

### 4. With-pieces variant: exercise `createDataSetAndAddPieces` path

### 4a. Upload canary piece

Dealbot calls `uploadPieceStreaming` to push a small fixed canary piece (256 bytes, all `0x61`) to the SP's HTTP storage service. The piece is deterministic so a leaked data set can always be identified by its piece CID alongside the `dealbotLifecycleCheck` metadata key.

### 4b. Verify piece ingestion

Dealbot calls `findPiece` with `retry: true`, polling until the SP confirms it has ingested the piece. This pre-flight step prevents `createDataSetAndAddPieces` from failing due to upload processing delays.

### 4c. Create data set with piece

Dealbot calls `createDataSetAndAddPieces` (from `@filoz/synapse-core/sp`) to atomically create the data set and register the canary piece on-chain in a single transaction. The data set is tagged with the same `dealbotLifecycleCheck` metadata.

### 4d. Wait for confirmation

Dealbot calls `waitForCreateDataSetAddPieces` with the `statusUrl` returned by the SP. When the SP confirms both the data set creation and piece addition on-chain, it resolves with `{ dataSetId, piecesIds }`.

### 5. Terminate the service (both variants)

Dealbot calls `terminateServiceSync` (from `@filoz/synapse-core/warm-storage`) on the newly created `dataSetId`. This submits the terminate transaction and waits for the receipt, confirming the termination was recorded on-chain. This is Step 1 of the [full on-chain termination sequence](#what-happens-on-chain-after-terminateservice-is-called). The job does not wait for the full ~30-day rail finalization.

The entire check (all variant steps + termination) is bounded by `DATA_SET_LIFECYCLE_CHECK_JOB_TIMEOUT_SECONDS`. A timeout is classified as `failure.timedout`.

## Check Status Progression

Each variant records a single terminal status once per check. The status values are the same for both variants.

**Empty variant** — recorded via [`dataSetLifecycleCheckStatus`](./events-and-metrics.md#dataSetLifecycleCheckStatus):

| Overall Status | Meaning |
|--------|---------|
| `success` | All steps passed: empty data set created, confirmed on-chain, service terminated. |
| `failure.timedout` | The job was aborted because it exceeded `DATA_SET_LIFECYCLE_CHECK_JOB_TIMEOUT_SECONDS`. |
| `failure.other` | Any other failure: `createDataSet` failed, `waitForCreateDataSet` failed, or `terminateService` failed. |

**With-pieces variant** — recorded via [`dataSetWithPiecesLifecycleCheckStatus`](./events-and-metrics.md#dataSetWithPiecesLifecycleCheckStatus):

| Overall Status | Meaning |
|--------|---------|
| `success` | All steps passed: canary piece uploaded and ingested, data set created with piece, confirmed on-chain, service terminated. |
| `failure.timedout` | The job was aborted because it exceeded `DATA_SET_LIFECYCLE_CHECK_JOB_TIMEOUT_SECONDS`. |
| `failure.other` | Any other failure: upload failed, `findPiece` timed out, `createDataSetAndAddPieces` failed, or `terminateService` failed. |

## Metrics Recorded

Metric definitions live in [Dealbot Events & Metrics](./events-and-metrics.md). Metrics are emitted under a distinct `checkType` label per variant so dashboards can track them independently.

**Empty variant:**
- [`dataSetLifecycleCheckStatus`](./events-and-metrics.md#dataSetLifecycleCheckStatus) — `success`, `failure.timedout`, or `failure.other` per provider per run
- [`dataSetLifecycleCheckMs`](./events-and-metrics.md#dataSetLifecycleCheckMs) — end-to-end duration (createDataSet + waitForCreateDataSet + terminateServiceSync); emitted on `success` and `failure.timedout`

**With-pieces variant:**
- [`dataSetWithPiecesLifecycleCheckStatus`](./events-and-metrics.md#dataSetWithPiecesLifecycleCheckStatus) — `success`, `failure.timedout`, or `failure.other` per provider per run
- [`dataSetWithPiecesLifecycleCheckMs`](./events-and-metrics.md#dataSetWithPiecesLifecycleCheckMs) — end-to-end duration (upload + findPiece + createDataSetAndAddPieces + waitForCreateDataSetAddPieces + terminateServiceSync); emitted on `success` and `failure.timedout`

## Configuration

Key environment variables that control data set lifecycle check behavior:

| Variable | Description |
|----------|-------------|
| `DATASET_LIFECYCLE_CHECK_ENABLED` | Enables or disables both variants of the check. Defaults to `true` on calibration, `false` on mainnet. When disabled, stale schedules are removed so they stop enqueuing no-op jobs. |
| `DATASET_LIFECYCLE_CHECKS_PER_SP_PER_HOUR` | Per-SP check rate. Each tick runs one variant (coin-flip). Independent of `DATASET_CREATIONS_PER_SP_PER_HOUR`. |
| `DATA_SET_LIFECYCLE_CHECK_JOB_TIMEOUT_SECONDS` | Max end-to-end job runtime before forced abort. Applies to whichever variant runs per tick. Default `600`. |

Source: [`apps/backend/src/config/app.config.ts`](../../apps/backend/src/config/app.config.ts)

See also: [`docs/environment-variables.md`](../environment-variables.md) for the source-of-truth configuration reference.

## FAQ

### What happens on-chain after `terminateService` is called?

`terminateService` does not delete a data set instantly. It starts a multi-step on-chain sequence that plays out over roughly 30 days. The lifecycle check only waits for the first step before it exits.

**Step 1 — terminateService confirms.** `terminateService` calls `FilecoinPay.terminateRail(pdpRailId)`, which sets `endEpoch = block.number + lockupPeriod` on the PDP rail. The FWSS `railTerminated` callback fires in the same transaction, stores `info.pdpEndEpoch`, and emits `PDPPaymentsTerminated` and `ServiceTerminated`. This is the point dealbot polls for: `pdpEndEpoch != 0`.

**Step 2 — rail finalization (~30 days later).** When the PDP rail's `settledUpTo` reaches `endEpoch`, `finalizeTerminatedRail` fires atomically inside the settle transaction.

**Step 3 — data set deletion at PDPVerifier (SP-initiated).** After the rail finalizes, the SP may call `PDPVerifier.deleteDataSet`. The lifecycle check does not wait for steps 2 or 3 — waiting ~30 days per invocation would defeat the purpose of a canary.

### Why two variants?

The data storage check (`data_set_creation` job) uses `createDataSetAndAddPieces` internally when creating a new data set with a piece. A canary that only exercises `createDataSet` would leave `createDataSetAndAddPieces` untested by the lifecycle check.

Running both variants in the same tick would double the per-tick on-chain transaction cost — two `createDataSet`/`terminateService` round trips instead of one. The coin-flip approach avoids this: exactly one variant runs per tick, keeping cost identical to the previous single-check budget. Both paths are covered in expectation over two ticks.

The empty variant exercises the `createDataSet → waitForCreateDataSet → terminateService` path. The with-pieces variant exercises `uploadPieceStreaming → findPiece → createDataSetAndAddPieces → waitForCreateDataSetAddPieces → terminateService`. The two `checkType` label values (`dataSetLifecycleCheck` and `dataSetWithPiecesLifecycleCheck`) let Grafana track them as independent time series.

### What if creation succeeds but termination fails?

If creation succeeds but termination fails (process crash, job timeout, or an on-chain error that is not an already-terminated no-op), the created data set stays live on the SP. This is called a leak and is an accepted trade-off for keeping the job self-contained.

Leaked sets are discoverable by filtering data sets with the `dealbotLifecycleCheck` metadata key — this key is set by both variants. For the with-pieces variant, the canary piece is additionally identifiable by its fixed piece CID (256 bytes, all `0x61`). Each leak is recorded in the log line (message: "throwaway data set may have leaked") with the `dataSetId` included for easy identification.

### Why does the job create and terminate in the same run?

An earlier design terminated an existing managed slot and relied on `data_set_creation` to recreate it on a later tick. That approach was coupled to `MIN_NUM_DATASETS_FOR_CHECKS`, a minimum-index window, and the creation job's schedule — making the canary sensitive to overall provider state.

The current design is self-contained: it always creates a fresh data set and terminates it in the same run. The check works regardless of provider state and needs no coordination with other jobs.
