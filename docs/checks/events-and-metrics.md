# Dealbot Events & Metrics

This document is the **source of truth** for the events emitted by dealbot checks and the metrics computed from them. It is intended for dashboard consumers and maintainers who need to understand what each metric means and where it comes from.

This document describes the expected flow and metrics. Items marked **TBD** are not yet implemented.

## Event Model

Events are grouped by check type. Each event includes a short definition, its implementation status, and a link to the expected source of truth.

### Data Storage Events

| Event | Definition | Status | Source of truth |
|------|------------|:------:|-----------------|
| <a id="uploadToSpStart"></a>`uploadToSpStart` | Dealbot starts an upload attempt for a piece to an SP (before invoking the upload call). | **TBD** | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) |
| <a id="uploadToSpEnd"></a>`uploadToSpEnd` | Upload finishes when the PDP server returns a 2xx; piece CID is known; ingest metrics are recorded. | Yes | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) (`handleUploadComplete`) |
| <a id="pieceAdded"></a>`pieceAdded` | Piece submission is recorded on-chain by polling the PDP SP; transaction hash is known. | Yes | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) (`handleRootAdded`) |
| <a id="pieceConfirmed"></a>`pieceConfirmed` | Piece is confirmed on-chain by polling a chain RPC endpoint. | **TBD** | Synapse SDK callback (not yet tracked) |
| <a id="dealCreated"></a>`dealCreated` | Deal is marked `DEAL_CREATED` after the upload result is returned. | Yes | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) (`updateDealWithUploadResult`) |
| <a id="spIndexingComplete"></a>`spIndexingComplete` | SP has indexed the piece locally (`indexed=true`). | Yes (async) | [`ipni.strategy.ts`](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts) |
| <a id="spAdvertisedToIpni"></a>`spAdvertisedToIpni` | SP has announced the piece to IPNI (`advertised=true`). | Yes (async) | [`ipni.strategy.ts`](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts) |
| <a id="verifyIpniAdvertisement"></a>`verifyIpniAdvertisement` | Dealbot confirms IPNI has provider records for the root CID. | Yes (async) | [`ipni.strategy.ts`](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts) |
| <a id="ipniVerificationStart"></a>`ipniVerificationStart` | IPNI lookup begins for root CID + provider (deal creation flow). | **TBD** | [`ipni.strategy.ts`](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts) |
| <a id="ipniVerificationComplete"></a>`ipniVerificationComplete` | IPNI lookup completes (pass/fail) for root CID + provider. | Yes (async) | [`ipni.strategy.ts`](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts) |
| <a id="verifyIpfsRetrievalStart"></a>`verifyIpfsRetrievalStart` | Retrieval begins via SP IPFS gateway (`/ipfs/{rootCid}`). | **TBD** | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |
| <a id="verifyIpfsRetrievalFirstByteReceived"></a>`verifyIpfsRetrievalFirstByteReceived` | First byte received from `/ipfs/{rootCid}`. | **TBD** | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |
| <a id="verifyIpfsRetrievalLastByteReceived"></a>`verifyIpfsRetrievalLastByteReceived` | Last byte received from `/ipfs/{rootCid}`. | **TBD** | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |
| <a id="verifyIpfsRetrievalIntegrityCheck"></a>`verifyIpfsRetrievalIntegrityCheck` | Retrieved content matches expected CID. | **TBD** | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |

> See [Data Storage Check](./data-storage.md) for the end-to-end deal flow.

### Retrieval Events

| Event | Definition | Status | Source of truth |
|------|------------|:------:|-----------------|
| <a id="retrieveFromSpStart"></a>`retrieveFromSpStart` | Retrieval attempt begins for a piece via SP IPFS gateway. | **TBD** | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |
| <a id="retrieveFromSpFirstByteReceived"></a>`retrieveFromSpFirstByteReceived` | First byte received from a retrieval attempt. | **TBD** | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |
| <a id="retrieveFromSpEnd"></a>`retrieveFromSpEnd` | Retrieval attempt finishes (success or failure). | Yes | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |

> See [Retrieval Check](./retrievals.md) for the retrieval selection and verification process.

## Metrics

Metrics are derived from the events above. They are exported via Prometheus and recorded on deal or retrieval entities.

### Deal (Data Storage) Metrics

Timing metrics derived from events:

| Metric | Timer Starts | Timer Ends | Source of truth |
|--------|--------------|------------|-----------------|
| <a id="ingestLatencyMs"></a>`ingestLatencyMs` | [`uploadToSpStart`](#uploadToSpStart) | [`uploadToSpEnd`](#uploadToSpEnd) | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) |
| <a id="ingestThroughputBps"></a>`ingestThroughputBps` | [`uploadToSpStart`](#uploadToSpStart) | [`uploadToSpEnd`](#uploadToSpEnd) | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) |
| <a id="chainLatencyMs"></a>`chainLatencyMs` | [`uploadToSpEnd`](#uploadToSpEnd) | [`pieceAdded`](#pieceAdded) | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) |
| <a id="dealLatencyMs"></a>`dealLatencyMs` | [`uploadToSpStart`](#uploadToSpStart) | [`dealCreated`](#dealCreated) | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) |
| <a id="ipniTimeToIndexMs"></a>`ipniTimeToIndexMs` | [`uploadToSpEnd`](#uploadToSpEnd) | [`spIndexingComplete`](#spIndexingComplete) | [`ipni.strategy.ts`](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts) |
| <a id="ipniTimeToAdvertiseMs"></a>`ipniTimeToAdvertiseMs` | [`uploadToSpEnd`](#uploadToSpEnd) | [`spAdvertisedToIpni`](#spAdvertisedToIpni) | [`ipni.strategy.ts`](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts) |
| <a id="ipniTimeToVerifyMs"></a>`ipniTimeToVerifyMs` | [`uploadToSpEnd`](#uploadToSpEnd) | [`verifyIpniAdvertisement`](#verifyIpniAdvertisement) | [`ipni.strategy.ts`](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts) |

Prometheus metrics:

| Prometheus Metric | Type | Description |
|-------------------|------|-------------|
| `deals_created_total` | Counter | Total deals created, labeled by status and provider |
| `deal_creation_duration_seconds` | Histogram | End-to-end deal creation time |
| `deal_upload_duration_seconds` | Histogram | Upload (ingest) time |
| `deal_chain_latency_seconds` | Histogram | Time for on-chain confirmation |

### Retrieval Metrics

Timing metrics derived from events:

| Metric | Timer Starts | Timer Ends | Source of truth |
|--------|--------------|------------|-----------------|
| <a id="latencyMs"></a>`latencyMs` | [`retrieveFromSpStart`](#retrieveFromSpStart) | [`retrieveFromSpEnd`](#retrieveFromSpEnd) | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |
| <a id="ttfbMs"></a>`ttfbMs` | [`retrieveFromSpStart`](#retrieveFromSpStart) | [`retrieveFromSpFirstByteReceived`](#retrieveFromSpFirstByteReceived) | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |
| <a id="throughputBps"></a>`throughputBps` | [`retrieveFromSpStart`](#retrieveFromSpStart) | [`retrieveFromSpEnd`](#retrieveFromSpEnd) | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |
| <a id="bytesRetrieved"></a>`bytesRetrieved` | [`retrieveFromSpStart`](#retrieveFromSpStart) | [`retrieveFromSpEnd`](#retrieveFromSpEnd) | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |
| <a id="responseCode"></a>`responseCode` | [`retrieveFromSpEnd`](#retrieveFromSpEnd) | [`retrieveFromSpEnd`](#retrieveFromSpEnd) | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |

Prometheus metrics:

| Prometheus Metric | Type | Description |
|-------------------|------|-------------|
| `retrievals_tested_total` | Counter | Total retrievals tested, labeled by status, method, and provider |
| `retrieval_latency_seconds` | Histogram | Total retrieval download latency |
| `retrieval_ttfb_seconds` | Histogram | Time to first byte |

## Definitions and Usage Notes

- **Source of truth:** The code links above are the authoritative definitions.
- **Timing metrics:** Metrics are recorded for observability; there are no timing-based quality assertions, aside from max-runtime thresholds (**TBD**).
