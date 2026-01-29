# Dealbot Events & Metrics

This document is the **source of truth** for the events emitted by dealbot checks and the metrics computed from them. It is intended for dashboard consumers and maintainers who need to understand what each metric means and where it comes from.

This document describes the **ideal end state**. Items marked **TBD** are not yet implemented.

## Event Model

Events are grouped by check type. Each event includes a short definition, its implementation status, and a link to the expected source of truth.

### Data Storage Events

| Event | Definition | Status | Source of truth |
|------|------------|:------:|-----------------|
| `uploadToSpStart` | Dealbot begins attempting to send a piece to an SP. | **TBD** | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) |
| `uploadToSpEnd` | Upload finishes; piece CID is known; ingest metrics recorded. | Yes | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) (`handleUploadComplete`) |
| `pieceAdded` | Piece submission is recorded on-chain; transaction hash known. | Yes | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) (`handleRootAdded`) |
| `pieceConfirmed` | Piece is confirmed on-chain. | **TBD** | Synapse SDK callback (not yet tracked) |
| `spIndexingComplete` | SP has indexed the piece locally (`indexed=true`). | Yes (async) | [`ipni.strategy.ts`](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts) |
| `spAdvertisedToIpni` | SP has advertised the piece to IPNI (`advertised=true`). | Yes (async) | [`ipni.strategy.ts`](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts) |
| `verifyIpniAdvertisement` | Dealbot confirms IPNI has provider records for the root CID. | Yes (async) | [`ipni.strategy.ts`](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts) |
| `verifyIpfsRetrievalStart` | Retrieval begins via SP IPFS gateway (`/ipfs/{rootCid}`). | **TBD** | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |
| `verifyIpfsRetrievalFirstByteReceived` | First byte received from `/ipfs/{rootCid}`. | **TBD** | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |
| `verifyIpfsRetrievalLastByteReceived` | Last byte received from `/ipfs/{rootCid}`. | **TBD** | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |
| `verifyIpfsRetrievalIntegrityCheck` | Retrieved content matches expected CID. | **TBD** | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |

> See [Data Storage Check](./data-storage.md) for the end-to-end deal flow.

### Retrieval Events

| Event | Definition | Status | Source of truth |
|------|------------|:------:|-----------------|
| `retrieveFromSpStart` | Retrieval attempt begins for a deal via SP IPFS gateway. | **TBD** | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |
| `retrieveFromSpEnd` | Retrieval attempt finishes (success or failure). | Yes | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |
| `ipniVerificationStart` | IPNI lookup begins for root CID + provider. | **TBD** | [`ipni.strategy.ts`](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts) |
| `ipniVerificationComplete` | IPNI lookup completes (pass/fail). | Yes | [`ipni.strategy.ts`](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts) |

> See [Retrieval Check](./retrievals.md) for the retrieval selection and verification process.

## Metrics

Metrics are derived from the events above. They are exported via Prometheus and recorded on deal or retrieval entities.

### Deal (Data Storage) Metrics

| Metric | Definition | Source of truth |
|--------|------------|-----------------|
| `ingestLatencyMs` | Time from upload start to upload completion. | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) |
| `ingestThroughputBps` | Upload throughput in bytes per second. | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) |
| `chainLatencyMs` | Time from upload completion to on-chain piece addition. | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) |
| `dealLatencyMs` | Total time from upload start to deal confirmation. | [`deal.service.ts`](../../apps/backend/src/deal/deal.service.ts) |
| `ipniTimeToIndexMs` | Time from upload completion to `sp_indexed`. | [`ipni.strategy.ts`](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts) |
| `ipniTimeToAdvertiseMs` | Time from upload completion to `sp_advertised`. | [`ipni.strategy.ts`](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts) |
| `ipniTimeToVerifyMs` | Time from upload completion to IPNI verification. | [`ipni.strategy.ts`](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts) |

Prometheus metrics:

| Prometheus Metric | Type | Description |
|-------------------|------|-------------|
| `deals_created_total` | Counter | Total deals created, labeled by status and provider |
| `deal_creation_duration_seconds` | Histogram | End-to-end deal creation time |
| `deal_upload_duration_seconds` | Histogram | Upload (ingest) time |
| `deal_chain_latency_seconds` | Histogram | Time for on-chain confirmation |

### Retrieval Metrics

| Metric | Definition | Source of truth |
|--------|------------|-----------------|
| `latencyMs` | Total retrieval download time. | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |
| `ttfbMs` | Time to first byte for retrieval. | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |
| `throughputBps` | Download throughput in bytes per second. | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |
| `bytesRetrieved` | Total bytes downloaded. | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |
| `responseCode` | HTTP response code from retrieval endpoint. | [`retrieval.service.ts`](../../apps/backend/src/retrieval/retrieval.service.ts) |

Prometheus metrics:

| Prometheus Metric | Type | Description |
|-------------------|------|-------------|
| `retrievals_tested_total` | Counter | Total retrievals tested, labeled by status, method, and provider |
| `retrieval_latency_seconds` | Histogram | Total retrieval download latency |
| `retrieval_ttfb_seconds` | Histogram | Time to first byte |

## Definitions and Usage Notes

- **Source of truth:** The code links above are the authoritative definitions.
- **Timing metrics:** Metrics are recorded for observability; there are no timing-based quality assertions, aside from max-runtime thresholds (**TBD**).
