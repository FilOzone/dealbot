# Dealbot Events & Metrics

This document is the intended **source of truth** for the events emitted by dealbot [checks](./README.md#check) and the metrics computed from them. It is intended for dealbot dashboard consumers and maintainers who need to understand what each metric means and where it comes from.

This document describes the expected flow and metrics. Items marked **TBD** are not yet implemented but will get reviewed and cleaned up as part of https://github.com/FilOzone/dealbot/issues/280.

## Anonymous Retrieval Event Model

The [Anonymous Retrieval check](./anon-retrievals.md) is a single-shot flow per piece: select → fetch piece → (optional) parse CAR + IPNI + block fetch → write one ClickHouse row.

It is not modeled as a sequence of named lifecycle events. Instead it emits:

- **Outcome metrics** when each step completes — see the [time](#time-related-metrics) and [status](#status-count-related-metrics) metric tables for `anonPieceRetrievalFirstByteMs`, `anonRetrievalCheckMs`, `anonRetrievalStatus`, `anonCarParseStatus`, `anonIpniStatus`, `anonBlockFetchStatus`, and friends.
- **One row per attempt** in the `anon_retrieval_checks` [ClickHouse table](#clickhouse-tables), emitted even on abort or unexpected error.
- **Structured log lines** (`anon_retrieval_started`, `anon_retrieval_completed`, `anon_retrieval_no_piece`, `anon_retrieval_car_validation_failed`, `anon_retrieval_clickhouse_insert_failed`) carrying a `retrievalId` so each row can be joined back to log evidence.

## Data Storage Event Model

Below are the sequence of events for a [Data Storage check](./data-storage.md).  The Data Storage flow is used because it encapsulates a [Retrieval check](./retrievals.md) as well.

### Data Storage Event Timeline

```mermaid
sequenceDiagram
  autonumber
  participant Dealbot
  participant SP as PDP Storage Provider
  participant RPC as Chain RPC Provider
  participant IPNI as filecoinpin.contact IPNI Instance

  rect rgb(50, 50, 50)
    %% Data Storage Only
    Dealbot->>SP: uploadToSpStart
    SP-->>Dealbot: uploadToSpEnd (2xx, piece CID)
    Dealbot-->>Dealbot: dealCreated (upload result returned)
    SP-->>Dealbot: pieceAdded (tx hash, async)
    RPC-->>Dealbot: pieceConfirmed (TBD, async)
    SP-->>Dealbot: spIndexingComplete
    SP-->>Dealbot: spAnnouncedAdvertisementToIpni
  end

  Dealbot->>IPNI: ipniVerificationStart (TBD)
  IPNI-->>Dealbot: ipniVerificationComplete
  Dealbot-->>SP: ipfsRetrievalStart (TBD)
  SP-->>Dealbot: ipfsRetrievalFirstByteReceived (TBD)
  SP-->>Dealbot: ipfsRetrievalLastByteReceived (TBD)
  Dealbot-->>Dealbot: ipfsRetrievalIntegrityChecked (TBD)
```

### Event List

| Event | Definition | Relevant Checks | Implemented | Source of truth |
|------|------------|:------:|:------:|-----------------|
| <a id="uploadToSpStart"></a>`uploadToSpStart` | Dealbot is about to start an upload attempt for a piece to an SP. | Data Storage | **TBD** | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) |
| <a id="uploadToSpEnd"></a>`uploadToSpEnd` | Upload finished (success with HTTP 2xx, failure). | Data Storage | Yes | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) (`handleStored`) |
| <a id="dealCreated"></a>`dealCreated` | Deal is marked `DEAL_CREATED` if the upload result is successful. | Data Storage | Yes | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) (`updateDealWithUploadResult`) |
| <a id="pieceAdded"></a>`pieceAdded` | Piece submission is recorded on-chain by polling the PDP SP; transaction hash is known. | Data Storage | Yes | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) (`handleRootAdded`) |
| <a id="pieceConfirmed"></a>`pieceConfirmed` | Piece is confirmed on-chain by polling a chain RPC endpoint. | Data Storage | **TBD** | Synapse SDK callback (not yet tracked) |
| <a id="spIndexingComplete"></a>`spIndexingComplete` | By polling SP, dealbot learned SP has indexed the piece locally (`indexed=true`). | Data Storage | Yes | [`ipni.strategy.ts`](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts) |
| <a id="spAnnouncedAdvertisementToIpni"></a>`spAnnouncedAdvertisementToIpni` | By polling SP, dealbot learned SP has announced the advertisement to IPNI (`advertised=true`). | Data Storage | Yes | [`ipni.strategy.ts`](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts) |
| <a id="ipniVerificationStart"></a>`ipniVerificationStart` | Dealbot begins polling filecoinpin.contact for <IpfsRootCid,SP> provider record. | Data Storage, Retrieval | **TBD** | [`ipni.strategy.ts`](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts) |
| <a id="ipniVerificationComplete"></a>`ipniVerificationComplete` | IPNI verification completes (pass or timeout). | Data Storage, Retrieval | Yes | [`ipni.strategy.ts`](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts) |
| <a id="ipfsRetrievalStart"></a>`ipfsRetrievalStart` | Dealbot to SP `/ipfs/` retrieval begins. | Data Storage, Retrieval | **TBD** | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |
| <a id="ipfsRetrievalFirstByteReceived"></a>`ipfsRetrievalFirstByteReceived` | First byte received from `/ipfs/{rootCid}`. | Data Storage, Retrieval | **TBD** | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |
| <a id="ipfsRetrievalLastByteReceived"></a>`ipfsRetrievalLastByteReceived` | Last byte received from `/ipfs/{rootCid}`. | Data Storage, Retrieval |**TBD** | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |
| <a id="ipfsRetrievalIntegrityChecked"></a>`ipfsRetrievalIntegrityChecked` | Retrieved content matches expected CID. | Data Storage, Retrieval | **TBD** | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |

## Metrics

* Many of the metrics below are derived from the [events above](#event-list).
* They are exported via Prometheus.
* All Prometheus/OpenTelemetry metrics have label/attributes for:
   - `network=calibration|mainnet`
   - `checkType=dataStorage|retrieval|dataRetention|dataSetCreation` — attribute metrics to a particular check/job
   - `providerId` — attribute metrics to a particular SP
   - `providerName` — human-readable name of the SP (defaults to `"unknown"` when not available)
   - `providerStatus=approved|unapproved` — attribute metrics to only approved SPs for example

### Time Related Metrics

* All time-related metrics are emitted as histograms.
* Histogram buckets are defined in **TBD** .

| Metric | Relevant Checks | Timer Starts | Timer Ends | Additional Info | Source of truth |
|--------|----------------|--------------|------------|-----------------|-----------------|
| <a id="ingestMs"></a>`ingestMs` | Data Storage | [`uploadToSpStart`](#uploadToSpStart) | [`uploadToSpEnd`](#uploadToSpEnd) |  | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) |
| <a id="ingestThroughputBps"></a>`ingestThroughputBps` | Data Storage | n/a | n/a | `(uploadedPieceBytes / ingestMs) * 1000` | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) |
| <a id="pieceAddedOnChainMs"></a>`pieceAddedOnChainMs` | Data Storage | [`uploadToSpEnd`](#uploadToSpEnd) | [`pieceAdded`](#pieceAdded) |  | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) |
| <a id="pieceConfirmedOnChainMs"></a>`pieceConfirmedOnChainMs` | Data Storage | [`pieceAdded`](#pieceAdded) | [`pieceConfirmed`](#pieceConfirmed) |  | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) |
| <a id="spIndexLocallyMs"></a>`spIndexLocallyMs` | Data Storage | [`uploadToSpEnd`](#uploadToSpEnd) | [`spIndexingComplete`](#spIndexingComplete) |  | [`ipni.strategy.ts`](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts) |
| <a id="spAnnounceAdvertisementMs"></a>`spAnnounceAdvertisementMs` | Data Storage | [`uploadToSpEnd`](#uploadToSpEnd) | [`spAnnouncedAdvertisementToIpni`](#spAnnouncedAdvertisementToIpni) |  | [`ipni.strategy.ts`](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts) |
| <a id="ipniVerifyMs"></a>`ipniVerifyMs` | Data Storage, Retrieval | [`ipniVerificationStart`](#ipniVerificationStart) | [`ipniVerificationComplete`](#ipniVerificationComplete) |  | [`ipni.strategy.ts`](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts) |
| <a id="ipfsRetrievalFirstByteMs"></a>`ipfsRetrievalFirstByteMs` | Data Storage, Retrieval | [`ipfsRetrievalStart`](#ipfsRetrievalStart) | [`ipfsRetrievalFirstByteReceived`](#ipfsRetrievalFirstByteReceived) |  | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |
| <a id="ipfsRetrievalBlockFirstByteMs"></a>`ipfsRetrievalBlockFirstByteMs` | Data Storage, Retrieval | Each IPFS block request | First byte received for each block | Emitted for block-fetch retrievals (one observation per block) | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |
| <a id="ipfsRetrievalLastByteMs"></a>`ipfsRetrievalLastByteMs` | Data Storage, Retrieval | [`ipfsRetrievalStart`](#ipfsRetrievalStart) | [`ipfsRetrievalLastByteReceived`](#ipfsRetrievalLastByteReceived) |  | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |
| <a id="ipfsRetrievalThroughputBps"></a>`ipfsRetrievalThroughputBps` | Data Storage, Retrieval | n/a | n/a | `(downloadedCarBytes / ipfsRetrievalLastByteMs) * 1000` | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |
| <a id="dataStorageCheckMs"></a>`dataStorageCheckMs` | Data Storage | [`uploadToSpStart`](#uploadToSpStart) | [`ipfsRetrievalIntegrityChecked`](#ipfsRetrievalIntegrityChecked) | Duration of a Data Storage check | |
| <a id="retrievalCheckMs"></a>`retrievalCheckMs` | Retrieval | Retrieval check start | [`ipfsRetrievalIntegrityChecked`](#ipfsRetrievalIntegrityChecked) | Duration of a Retrieval check | |
| <a id="dataSetCreationMs"></a>`dataSetCreationMs` | Data-Set Creation | Data-set creation uploadToSpStart | Data-set creation pieceConfirmed | Duration of one data-set creation with confirmed piece (all using `createDataSetWithPiece`) | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) |
| <a id="anonPieceRetrievalFirstByteMs"></a>`anonPieceRetrievalFirstByteMs` | Anonymous Retrieval | Piece fetch start | First byte received from `/piece/{pieceCid}` | Time to first byte for anonymous piece retrievals | [`anon-retrieval.service.ts`](../../apps/backend/src/retrieval-anon/anon-retrieval.service.ts) |
| <a id="anonPieceRetrievalLastByteMs"></a>`anonPieceRetrievalLastByteMs` | Anonymous Retrieval | Piece fetch start | Last byte received from `/piece/{pieceCid}` | Total time to retrieve an anonymous piece | [`anon-retrieval.service.ts`](../../apps/backend/src/retrieval-anon/anon-retrieval.service.ts) |
| <a id="anonPieceRetrievalThroughputBps"></a>`anonPieceRetrievalThroughputBps` | Anonymous Retrieval | n/a | n/a | `(bytesRetrieved / anonPieceRetrievalLastByteMs) * 1000` | [`anon-retrieval.service.ts`](../../apps/backend/src/retrieval-anon/anon-retrieval.service.ts) |
| <a id="anonRetrievalCheckMs"></a>`anonRetrievalCheckMs` | Anonymous Retrieval | Anon retrieval check start | After CAR/IPNI/block-fetch validation completes (or on abort) | End-to-end anonymous retrieval check duration | [`anon-retrieval.service.ts`](../../apps/backend/src/retrieval-anon/anon-retrieval.service.ts) |


### Status Count Related Metrics

- These count metrics are used to track the occurrence of a particular status for a check.
- All Prometheus/OpenTelemetry status count metrics have additonal label/attributes for:
   - `value` - attribute counts to different outcomes.

| Metric | Relevant Checks | When Emitted In Successful Case| `value` Values | Source of truth |
|---|---|---|---|---|
| <a id="dataStorageUploadStatus"></a>`dataStorageUploadStatus` | Data Storage | [`uploadToSpEnd`](#uploadToSpEnd) | `success`, `failure.timedout`, `failure.other` from [Data Storage Sub-status meanings](./data-storage.md#sub-status-meanings). |  |
| <a id="dataStorageOnchainStatus"></a>`dataStorageOnchainStatus` | Data Storage | [`pieceConfirmed`](#pieceConfirmed) | `success`, `failure.timedout`, `failure.other` frin [Data Storage Sub-status meanings](./data-storage.md#sub-status-meanings). | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) |
| <a id="dataStorageStatus"></a>`dataStorageStatus` | Data Storage | When the Data Storage check completes (all four sub-statuses done) | `success`, `failure.timedout`, `failure.other` from [Deal Status Progression](./data-storage.md#deal-status-progression). | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) |
| <a id="discoverabilityStatus"></a>`discoverabilityStatus` | Data Storage, Retrieval | [`ipniVerificationComplete`](#ipniVerificationComplete) | `success`, `failure.timedout`, `failure.other` from [Data Storage Sub-status meanings](./data-storage.md#sub-status-meanings). |  |
| <a id="ipfsRetrievalHttpResponseCode"></a>`ipfsRetrievalHttpResponseCode` | Data Storage, Retrieval | [`ipfsRetrievalLastByteReceived`](#ipfsRetrievalLastByteReceived) | `200`, `500`, `2xxSuccess`, `4xxClientError`, `5xxServerError`, `otherHttpStatusCodes`, `failure` | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |
| <a id="retrievalStatus"></a>`retrievalStatus` | Data Storage, Retrieval | [`ipfsRetrievalIntegrityChecked`](#ipfsRetrievalIntegrityChecked) | `success`, `failure.timedout`, `failure.other` from [Data Storage Sub-status meanings](./data-storage.md#sub-status-meanings). |  |
| <a id="dataSetCreationStatus"></a>`dataSetCreationStatus` | Data-Set Creation | Not tied to an [event above](#event-list) but rather to data-set creation start (`pending`) and completion (`success`/`failure.*`) | `pending`, `success`, `failure.timedout`, `failure.other` | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) |
| <a id="dataSetChallengeStatus"></a>`dataSetChallengeStatus` | Data Retention | Not tied to an [event above](#event-list) but rather to the periodic chain-checking done in the [Data Retention Check](./data-retention.md) | `success`, `failure` | [`data-retention.service.ts`](../../apps/backend/src/data-retention/data-retention.service.ts) |
| <a id="pdp_provider_overdue_periods"></a>`pdp_provider_overdue_periods` | Data Retention | Emitted on every poll | Gauge value (estimated overdue periods) | [`data-retention.service.ts`](../../apps/backend/src/data-retention/data-retention.service.ts) |
| <a id="anonRetrievalStatus"></a>`anonRetrievalStatus` | Anonymous Retrieval | After piece fetch completes (or on abort) | `success` (HTTP 2xx **and** CommP matches), `failure.http`, `failure.commp` (HTTP 2xx but bytes hashed to a different CID), `failure.aborted`, `failure.no_piece`. | [`anon-retrieval.service.ts`](../../apps/backend/src/retrieval-anon/anon-retrieval.service.ts) |
| <a id="anonPieceHttpResponseCode"></a>`anonPieceHttpResponseCode` | Anonymous Retrieval | After piece fetch completes | `200`, `500`, `2xxSuccess`, `4xxClientError`, `5xxServerError`, `otherHttpStatusCodes`, `failure` (same classifier as [`ipfsRetrievalHttpResponseCode`](#ipfsRetrievalHttpResponseCode)) | [`anon-retrieval.service.ts`](../../apps/backend/src/retrieval-anon/anon-retrieval.service.ts) |
| <a id="anonCarParseStatus"></a>`anonCarParseStatus` | Anonymous Retrieval | After CAR validation runs (skipped when piece fetch failed or piece is not IPFS-indexed) | `parseable`, `not_parseable` | [`anon-retrieval.service.ts`](../../apps/backend/src/retrieval-anon/anon-retrieval.service.ts) |
| <a id="anonIpniStatus"></a>`anonIpniStatus` | Anonymous Retrieval | After CAR validation runs, **or** when piece fetch failed (records `skipped`) | `valid`, `invalid`, `skipped`, `error` | [`anon-retrieval.service.ts`](../../apps/backend/src/retrieval-anon/anon-retrieval.service.ts) |
| <a id="anonBlockFetchStatus"></a>`anonBlockFetchStatus` | Anonymous Retrieval | After block-fetch sampling runs, **or** when piece fetch failed (records `skipped`) | `valid`, `invalid`, `skipped`, `error` | [`anon-retrieval.service.ts`](../../apps/backend/src/retrieval-anon/anon-retrieval.service.ts) |

## ClickHouse Tables

When `CLICKHOUSE_URL` is configured, dealbot writes one row per check result to ClickHouse for long-term storage and analysis. All tables are partitioned by month with a 1-year TTL.

> **Source of truth**: the DDL and column-level comments in [`clickhouse.schema.ts`](../../apps/backend/src/clickhouse/clickhouse.schema.ts) are authoritative. The summary below is for orientation only.

- **`data_storage_checks`** — one row written each time a deal is saved (on every status transition). Populated by [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts).
- **`retrieval_checks`** — one row per retrieval attempt. Populated by [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts).
- **`anon_retrieval_checks`** — one row per [Anonymous Retrieval check](./anon-retrievals.md) attempt; emitted even on abort or unexpected error. Populated by [`anon-retrieval.service.ts`](../../apps/backend/src/retrieval-anon/anon-retrieval.service.ts). See [Anonymous Retrieval § Result Recording](./anon-retrievals.md#result-recording) for column-level meanings.
- **`data_retention_challenges`** — one row per provider per poll cycle. Populated by [`data-retention.service.ts`](../../apps/backend/src/data-retention/data-retention.service.ts).

All tables share the primary key `(probe_location, sp_address, timestamp)`:

- `probe_location` - identifies which dealbot instance produced the row, allowing multiple deployments to be distinguished in queries (set via `DEALBOT_PROBE_LOCATION`)
- `sp_address` - the Ethereum/FEVM address of the storage provider under test
- `timestamp` - when the row was written (milliseconds UTC)
