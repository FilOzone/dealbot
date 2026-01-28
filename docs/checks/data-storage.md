# Data Storage Check

This document is the **source of truth** for how dealbot's Data Storage check is intended to work. Items marked **TBD** describe behavior that is not yet implemented; code changes will follow.

Source code links throughout this document point to the current implementation.

For event and metric definitions used by the dashboard, see [Dealbot Events & Metrics](./events-and-metrics.md).

## Overview

A "deal" is dealbot's end-to-end test of an upload to a storage provider (SP). Every deal cycle, dealbot:

1. Generates a random data file
2. Converts it to [CAR format](https://ipld.io/specs/transport/car/)
3. Uploads it to **every testing SP**, creating one dataset per SP (provider scope is controlled by `USE_ONLY_APPROVED_PROVIDERS`)
4. Waits for the SP to index the piece and confirm on-chain
5. Runs retrieval checks as defined in [Retrieval Check](./retrievals.md)

A deal is **not** considered successful until all of these steps pass.

### Definition of Successful Data Storage Operation

A **successful** Data Storage operation requires ALL of:

1. Dealbot uploads a test piece to the SP
2. SP confirms receipt and piece lands on-chain
3. Retrieval checks pass (see [Retrieval Check](./retrievals.md))

**Failure** occurs if any step fails or the deal exceeds its max allowed time. There are no timing-based quality assertions. Operational timeouts exist to prevent jobs from running indefinitely, but they are not quality assertions. A per-deal max time limit that fails the deal if exceeded is **TBD**.

## What Gets Asserted

Each deal asserts the following for every SP:

| # | Assertion | How It's Checked | Implemented? |
|---|-----------|-----------------|:---:|
| 1 | SP accepts data upload | Upload completes without error; piece CID is returned | Yes |
| 2 | Piece submission recorded on-chain | `onPieceAdded` callback fires with a transaction hash | Yes |
| 3 | Piece is confirmed on-chain | `onPieceConfirmed` callback fires | **TBD** |
| 4 | SP indexes piece locally | PDP server reports `indexed: true` | Yes (async) |
| 5 | Retrieval checks pass | See [Retrieval Check](./retrievals.md) for specific assertions | **TBD** (part of deal flow) |
| 6 | Deal completes within max time | Entire deal (all steps) completes within a configurable max time; otherwise marked failed | **TBD** |
| 7 | Deal blocked until all checks pass | Deal is not marked successful until assertions 1–6 pass | **TBD** |

> **Note on timing:** There are no timing-based quality assertions. See the [Definition section](#definition-of-successful-data-storage-operation) for timing policy. Timing metrics are recorded for observability only.

## Deal Lifecycle

The scheduler triggers deal creation on a configurable interval.

```
Generate random data
        |
        v
Convert to CAR format
        |
        v
For each testing SP (up to 10 in parallel):
    |
    +-- Create dataset on-chain via Synapse SDK (idempotent)
    +-- Upload CAR data to SP
    +-- Wait for SP to index the piece
    +-- Wait for on-chain confirmation
    +-- Run retrieval checks                              [TBD]
    +-- Mark deal as successful only after all checks pass [TBD]
```

**Key constraint:** One data file is generated per cycle and reused across all SPs. This ensures fair comparison — every SP is tested with identical data in a given cycle.

### 1. Generate Random Data

Dealbot generates a random binary file with a unique name and embedded markers (prefix/suffix with timestamp and unique ID). The same file is reused across all SPs in the cycle.

- **File format:** `random-{timestamp}-{uniqueId}.bin`
- **Possible sizes:** 10 KiB, 10 MB, or 100 MB (configurable via `RANDOM_DATASET_SIZES`)

Source: [`dataSource.service.ts` line 116](../../apps/backend/src/dataSource/dataSource.service.ts)

### 2. Convert to CAR Format

The raw data is converted to a CAR (Content Addressable Archive) file (via `filecoin-pin` integration — **TBD**):

1. The data is split into blocks (max 5 MB each)
2. Each block is hashed with SHA-256 to produce a CID
3. The first block's CID becomes the **root CID**
4. All blocks are packed into a CAR archive

This produces:
- A **root CID** that uniquely identifies the content
- An array of **block CIDs** for each chunk
- The **CAR file bytes** that get uploaded to the SP

Source: [`ipni.strategy.ts` line 530 (`convertToCar`)](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts)

### 3. Upload to Each SP

For each **testing SP**, dealbot:

1. **Creates a dataset on-chain** via the Synapse SDK (`synapse.createStorageContext()`), one dataset per SP. Dataset creation is idempotent (if a dataset with the same metadata already exists for the SP, it is reused).
2. **Uploads the CAR file** to the SP. Three callbacks track progress:
   - `onUploadComplete` — SP confirms receipt. Records the piece CID, upload latency, and throughput.
   - `onPieceAdded` — piece submission is recorded (transaction hash available). Indexing in the SP/Curio DB should be complete.
   - `onPieceConfirmed` — piece is confirmed on-chain. Records chain latency.

SPs are processed in parallel batches of up to 10. Failures for individual SPs do not block other SPs.

Source: [`deal.service.ts` line 100 (`createDeal`)](../../apps/backend/src/deal/deal.service.ts)

#### Testing Provider Scope

The set of **testing providers** is determined by configuration:

- Only **active PDP providers** are eligible (dev-tagged providers are excluded)
- If `USE_ONLY_APPROVED_PROVIDERS=true` (default), only approved providers are tested

Source: [`wallet-sdk.service.ts` line 213 (`getTestingProviders`)](../../apps/backend/src/wallet-sdk/wallet-sdk.service.ts)

### 4. Wait for SP to Index and Confirm On-Chain

After upload completes, dealbot polls the SP's PDP server to track the piece through its lifecycle:

| Status | Meaning |
|--------|---------|
| `sp_indexed` | SP has indexed the piece locally — it is now retrievable |
| `sp_advertised` | SP has advertised the piece to the IPNI network |

- **Poll interval:** 2.5 seconds
- **Timeout:** 10 minutes (default; see `POLLING_TIMEOUT_MS`)

Once the SP reports `sp_indexed`, the content is retrievable via the SP IPFS gateway. This is the trigger for the next step.

Source: [`ipni.strategy.ts` line 343 (`monitorPieceStatus`)](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts)

### 5. Retrieve and Verify Content — **TBD**

> **TBD:** This step is not yet implemented as part of the deal creation flow. Currently, retrieval runs as a [separate scheduled job](../../apps/backend/src/retrieval/retrieval.service.ts) and does not block deal completion.

Once the SP has indexed the piece, dealbot runs the retrieval checks defined in [Retrieval Check](./retrievals.md). The deal is **not** marked as successful until those retrieval checks pass.

For details on retrieval methods and assertions, see [Retrieval Check](./retrievals.md).

### 6. IPNI Verification

After the SP advertises the piece to IPNI, dealbot verifies two things:

1. The **root CID** is discoverable via IPNI.
2. The **SP is listed as a provider** in the IPNI response for that root CID.

The verification flow:

1. Waits 30 seconds after `sp_advertised` for the IPNI indexer to process.
2. Queries IPNI for the root CID.
3. Checks that the IPNI response contains the expected SP as a provider for this content.

This uses the `waitForIpniProviderResults` function from the `filecoin-pin` library.

- **Lookup timeout:** 1 hour (derived from retry attempts and interval)
- **Retry interval:** 5 seconds

Source: [`ipni.strategy.ts` line 239 (`monitorAndVerifyIPNI`)](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts)

> **Current implementation note:** IPNI verification currently runs asynchronously and does not block the deal from being marked as `DEAL_CREATED`. The intended behavior is that a deal is not considered fully successful until IPNI verification also passes. **TBD.**

## Deal Status Progression

A deal moves through these statuses during creation:

```
PENDING ──> UPLOADED ──> PIECE_ADDED ──> DEAL_CREATED
   |            |             |               |
   v            v             v               v
 FAILED      FAILED        FAILED          FAILED
```

| Status | Meaning |
|--------|---------|
| `pending` | Deal entity created, upload not yet started |
| `uploaded` | SP confirmed receipt of the data (piece CID assigned) |
| `piece_added` | Piece confirmed on-chain (transaction hash recorded) |
| `deal_created` | Full upload result received; deal is complete |
| `failed` | Any step in the pipeline errored |

Source: [`apps/backend/src/database/types.ts` line 1 (`DealStatus`)](../../apps/backend/src/database/types.ts)

> **Note:** The current status model does not include retrieval verification or IPNI verification as gates. Statuses will need to be extended so a deal is not marked successful until all checks pass. **TBD.**

## IPNI Status Progression

Tracked independently from deal status, IPNI verification progresses through:

```
PENDING ──> SP_INDEXED ──> SP_ADVERTISED ──> SP_RECEIVED_RETRIEVE_REQUEST ──> VERIFIED
   |            |               |                      |                         |
   v            v               v                      v                         v
 FAILED      FAILED          FAILED                 FAILED                    (done)
```

| Status | Meaning |
|--------|---------|
| `pending` | IPNI monitoring started |
| `sp_indexed` | SP indexed the piece locally |
| `sp_advertised` | SP advertised the piece to IPNI |
| `verified` | Root CID is discoverable via IPNI and the SP is listed as a provider in the IPNI response |
| `failed` | Monitoring timed out or verification failed |

Source: [`apps/backend/src/database/types.ts` line 28 (`IpniStatus`)](../../apps/backend/src/database/types.ts)

## Metrics Recorded

Each deal records timing and throughput metrics:

| Metric | Description |
|--------|-------------|
| `ingestLatencyMs` | Time from upload start to SP confirmation |
| `ingestThroughputBps` | Upload throughput in bytes per second |
| `chainLatencyMs` | Time from upload confirmation to on-chain piece addition |
| `dealLatencyMs` | Total time from upload start to deal confirmation |
| `ipniTimeToIndexMs` | Time from upload to SP indexing the piece |
| `ipniTimeToAdvertiseMs` | Time from upload to SP advertising the piece |
| `ipniTimeToRetrieveMs` | Time from upload to SP receiving a retrieve request |
| `ipniTimeToVerifyMs` | Time from upload to IPNI verification of root CID |

Prometheus counters and histograms are also exported:

| Prometheus Metric | Type | Description |
|-------------------|------|-------------|
| `deals_created_total` | Counter | Total deals created, labeled by status and provider |
| `deal_creation_duration_seconds` | Histogram | End-to-end deal creation time |
| `deal_upload_duration_seconds` | Histogram | Upload (ingest) time |
| `deal_chain_latency_seconds` | Histogram | Time for on-chain confirmation |

## Configuration

Key environment variables that control deal creation behavior:

| Variable | Default | Description |
|----------|---------|-------------|
| `DEAL_INTERVAL_SECONDS` | `30` | How often deal creation runs |
| `ENABLE_IPNI_TESTING` | `always` | IPNI mode: `always`, `random`, or `disabled` |
| `ENABLE_CDN_TESTING` | `true` | Whether CDN is randomly enabled for deals |
| `RANDOM_DATASET_SIZES` | `10240,10485760,104857600` | Possible random file sizes in bytes (10 KiB, 10 MB, 100 MB) |
| `USE_ONLY_APPROVED_PROVIDERS` | `true` | Only test approved SPs |
| `DEAL_START_OFFSET_SECONDS` | `0` | Delay before first deal creation run |

Source: [`apps/backend/src/config/app.config.ts`](../../apps/backend/src/config/app.config.ts)

See also: [`docs/environment-variables.md`](../environment-variables.md) for the full configuration reference.

## Source Code Entry Points

| Step | File | Entry Point |
|------|------|-------------|
| Scheduler trigger | [`scheduler.service.ts`](../../apps/backend/src/scheduler/scheduler.service.ts) | `handleDealCreation()` (line 80) |
| Deal orchestration | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) | `createDealsForAllProviders()` (line 59) |
| Per-SP deal creation | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) | `createDeal()` (line 100) |
| Addon preprocessing | [`deal-addons.service.ts`](../../apps/backend/src/deal-addons/deal-addons.service.ts) | `preprocessDeal()` (line 64) |
| IPNI / CAR conversion | [`ipni.strategy.ts`](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts) | `preprocessData()` (line 90) |
| Random data generation | [`dataSource.service.ts`](../../apps/backend/src/dataSource/dataSource.service.ts) | `generateRandomDataset()` (line 116) |

## TBD Summary

The following items describe intended behavior that is not yet implemented:

| Item | Description |
|------|-------------|
| Inline retrieval verification | After SP indexes, immediately retrieve and verify content as part of the deal flow — deal must not be marked successful until retrieval passes (currently retrieval runs as a separate scheduled job) |
| CID-based content verification | Verify retrieved content by re-computing CID and comparing to upload-time CID (currently size-check only) |
| Per-deal max time limit | If the entire deal (all steps) does not complete within a configurable max time, mark the deal as failed. Currently, operational timeouts prevent infinite runs but are not treated as a quality assertion that fails the deal. |
| Deal gated on all checks | Deal should not be marked successful until retrieval and IPNI verification pass (currently IPNI runs async and does not block deal status) |
| Status model update | Deal statuses may need new states to reflect retrieval and IPNI verification gates |
| `onPieceConfirmed` callback tracking | Track `onPieceConfirmed` callback as a distinct step — piece confirmed on-chain (currently only `onPieceAdded` is tracked as a deal status gate) |
| IPFS gateway retrieval verification | After SP indexes, retrieve content via the SP IPFS gateway (`/ipfs/{rootCid}`) and verify it before the deal can pass |
| `filecoin-pin` CAR conversion | CAR conversion should use the `filecoin-pin` library integration (currently uses a local implementation in `ipni.strategy.ts`) |
