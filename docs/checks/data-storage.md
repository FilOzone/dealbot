# Data Storage Check

This document is the **source of truth** for how dealbot's Data Storage check works. (Items marked **TBD** are not yet implemented; code changes will follow.)

Source code links throughout this document point to the current implementation.

For event and metric definitions used by the dashboard, see [Dealbot Events & Metrics](./events-and-metrics.md).

## Overview

A "data storage check" is dealbot's end-to-end test of uploading a piece to a storage provider (SP) and confirming the uploaded data is publicly discoverable and retrievable.  ("Deal" is a synonym for "data storage check".)

Every data storage check, dealbot:

1. Generates a random data file
2. Converts it to [CAR format](https://ipld.io/specs/transport/car/)
3. Uploads the CAR to **[a testable SP](#3-determine-which-sps-to-check-for-this-cycle)** as a new piece in one of the [dealbot-managed datasets](#4-upload-to-each-sp).
4. Waits for: 
   - Onchain confirmation - the SP sends a message adding the piece to the dataset and dealbot confirms it onchain
   - IPNI discoverability - the SP indexes the CAR announces the index to IPNI and dealbot confirms that IPNI has the index.
5. Runs retrieval checks as defined in [Retrieval Check](./retrievals.md).

A successful operation requires all [assertions in the table below](./data-storage.md#what-gets-asserted) to pass.

Failure occurs if any step fails or the deal exceeds its max allowed time. There are no timing-based quality assertions. Operational timeouts exist to prevent jobs from running indefinitely, but they are not quality assertions.

## What Gets Asserted

Each deal asserts the following for every SP:

| # | Assertion | How It's Checked | [Sub Status Affected](#sub-status-meanings) | Retries | Relevant Metric for Setting a Max Duration | Implemented? |
|---|-----------|-----------------|:---:|:---:|-----------------------------------|:---:|
| 1 | SP accepts piece upload | Upload completes without error (HTTP 200); piece CID is returned | Upload | 1 | [`ingestMs`](./events-and-metrics.md#ingestMs) | Yes |
| 2 | Piece submission recorded on-chain | Synapse `onPieceAdded` callback fires with a transaction hash | Onchain | n/a | [`pieceAddedOnChainMs`](./events-and-metrics.md#pieceAddedOnChainMs) | Yes |
| 3 | Piece is confirmed on-chain | Synapse `onPieceConfirmed` callback fires | Onchain | n/a | [`pieceConfirmedOnChainMs`](./events-and-metrics.md#pieceConfirmedOnChainMs) | **TBD** |
| 4 | SP indexes piece locally | PDP server reports `indexed: true` | Discoverability | n/a | [`spIndexLocallyMs`](./events-and-metrics.md#spIndexLocallyMs) | Yes |
| 5 | Content is discoverable on filecoinpin.contact | IPNI index returns a <IpfsRootCid,SP> provider record | Discoverability | Polling with delay until timeout | [`ipniVerifyMs`](./events-and-metrics.md#ipniVerifyMs) | **TBD** |
| 6 | Content is retrievable | See [Retrieval Check](./retrievals.md#what-gets-asserted) for specific assertions | Retrieval | 0 | [`ipfsRetrievalLastByteMs`](./events-and-metrics.md#ipfsRetrievalLastByteMs) | **TBD** |
| 7 | All checks pass | Deal is not marked successful until all assertions pass within window | All four | n/a | [`dataStorageCheckMs`](./events-and-metrics.md#dataStorageCheckMs) | **TBD** |

## Deal Lifecycle

The dealbot scheduler triggers data storage check jobs at a configurable rate.

```mermaid
flowchart TD
  CreateCar --> SelectDataSet["Select a dataset for data storage check"]
  SelectDataSet --> Upload["Upload CAR as piece to SP"]
  Upload --> Chain["Wait for on-chain piece creation confirmation"]
  Upload --> LocalIndex["Wait for SP local indexing"]
  LocalIndex --> IpniAnnouncement["Wait for SP to announce local index to IPNI"]
  IpniAnnouncement --> IpniVerification["IPNI verification"]
  LocalIndex --> IpfsRetrieval["SP /ipfs Retrieval Check"]
  Chain --> CheckResults["Mark data storage check successful if all steps pass"]
  IpniVerification --> CheckResults
  IpfsRetrieval --> CheckResults
```

### 1. Generate Random Data

Dealbot generates a random binary file with a unique name and embedded markers (prefix/suffix with timestamp and unique ID).

- **File format:** `random-{timestamp}-{uniqueId}.bin`
- **Possible sizes:** Configurable via `RANDOM_PIECE_SIZES` (default: 10 MiB)

Source: [`dataSource.service.ts`](../../apps/backend/src/dataSource/dataSource.service.ts#L116)

### 2. Convert to CAR Format

The raw data is converted to a CAR (Content Addressable Archive) file (via `filecoin-pin` integration).  See https://github.com/filecoin-project/filecoin-pin/blob/master/documentation/behind-the-scenes-of-adding-a-file.md#create-car for more info.

Source: [`ipni.strategy.ts` (`convertToCar`)](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts#L530)

### 3. Upload to the SP

1. Select a previously created dataset for this data storage check.
2. **Uploads the CAR file** to the SP (adding a piece to the selected dataset). Callbacks track progress:
   - `onUploadComplete` — SP confirms receipt (HTTP 2xx). Records the piece CID.

Source: [`deal.service.ts` (`createDeal`)](../../apps/backend/src/deal/deal.service.ts#L100)

### 4. Wait for Onchain Confirmation

After upload completes, dealbot waits for the piece to be confirmed onchain.  The following callbacks are tracked:
   - `onPieceAdded` — piece submission is recorded as reported by the SP on-chain (transaction hash available).
   - `onPieceConfirmed` — confirm the piece is onchain by querying the chain RPC endpoint. filecoin-pin and synapse-sdk are doing this work under the hood

### 5. Wait for SP to Index and Announce Index to IPNI

After upload completes, dealbot polls the SP's PDP server to track the piece through its indexing lifecycle:
- **`sp_indexed`**: SP has indexed the piece locally. Any CID in the CAR is now retrievable with `/ipfs/$CID` retrieval, but it may not be discoverable by the rest of the network. Direct SP [retrieval checking](#8-retrieve-and-verify-content) can commence.
- **`sp_advertised`**: SP has announced the piece index to IPNI. (In IPNI terminology this is "advertisement announcement" (see [docs](https://docs.cid.contact/filecoin-network-indexer/technical-walkthrough))). [IPNI indexing verification](#7-verify-ipni-indexing) can commence.
- **Poll interval**: 2.5 seconds (see `TBD_VARIABLE`)

Source: [`ipni.strategy.ts` (`monitorPieceStatus`)](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts#L343)

### 6. Verify IPNI indexing

After the SP announces the piece index to IPNI, dealbot ensures the uploaded piece can be discovered by others with [standard IPFS tooling](https://github.com/filecoin-project/filecoin-pin/blob/master/documentation/glossary.md#standard-ipfs-tooling).  It does this by polling filecoinpin.contact for a valid provider record for the <IPFSRootCid,SP>.  

This uses the `waitForIpniProviderResults` function from the `filecoin-pin` library.

- **Polling interval:** 5 seconds (see `TBD_VARIABLE`)

Source: [`ipni.strategy.ts` (`monitorAndVerifyIPNI`)](../../apps/backend/src/deal-addons/strategies/ipni.strategy.ts#L239)

### 7. Retrieve and Verify Content — **TBD**

See [Retrieval Check](./retrievals.md) for the specifics of retrieving and verifying the returned bytes match the CID.

## Deal Status Progression

A deal's **overall status** is a function of four sub-statuses: **Upload**, **Onchain**, **Discoverability**, and **Retrieval**. The deal **succeeds** only if all four report success; **if any one fails**, the overall deal is a failure. The flow is sequential at the start, then branches:

1. **Upload** must succeed first.
2. After upload succeeds, **Onchain** and **Discoverability** run in parallel (two branches).
3. **Retrieval** runs as soon as **Discoverability** progresses past `sp_indexed`.


```mermaid
flowchart TD
  U["Upload Status"]
  O["Onchain Status"]
  D["Discoverability Status"]
  R["Retrieval Status"]
  OK["Data Storage Check success"]
  FAIL["Data Storage Check failure"]

  U -->|failure| FAIL
  U -->|success| O
  U -->|success| D
  D -->|sp_indexed| R

  O -->|failure| FAIL
  D -->|failure| FAIL
  R -->|failure| FAIL

  O -->|success| OK
  D -->|success| OK
  R -->|success| OK
```

It's expected that a Data Storage check will still store an overall status for easy querying:

| Overall Status | Meaning |
|--------|---------|
| `pending` | Upload Status = `pending` (i.e., piece upload to the SP hasn't started.) |
| `inProgress` | Data Storage check is running. |
| `success` | **All** sub-statuses are `success`. |
| `failure.timedout` | **Any** sub-status is `failure.timedout`. |
| `failure.other` | **Any** sub-status is `failure.other`. |

---

### Sub-status meanings

| Upload Status | Meaning |
|--------|---------|
| `pending` | Piece upload to the SP hasn't started. |
| `success` | SP confirmed receipt of the piece. |
| `failure.timedout` | Failed to upload within the allotted time.
| `failure.other` | Failed to upload for other reasons. |

| Onchain Status | Meaning |
|--------|---------|
| `pending` | Onchain verification hasn't started yet because waiting for successful upload. |
| `success` | Piece confirmed on-chain (transaction hash recorded). |
| `failure.timedout` | Failed to confirm piece onchain within the allotted time. |
| `failure.other` | Failed to confirm piece onchain for other reasons. |

| Discoverability Status | Meaning |
|--------|---------|
| `pending` | Discoverability verification hasn't started yet because waiting for successful upload. |
| `sp_indexed` | SP indexed the piece locally |
| `sp_announced_advertisement` | SP announced the local index to IPNI so IPNI can pull it from the SP. |
| `success` | Root CID is discoverable via IPNI and the SP is listed as a provider in the IPNI response. |
| `failure.timedout` | Dealbot failed to confirm <IPFSRootCid,SP> provider record within the allotted time |
| `failure.other` | Dealbot failed to confirm <IPFSRootCid,SP> provider record for other reasons. |

| Retrieval Status | Meaning |
|--------|---------|
| `pending` | Retrieval checking hasn't started yet because Discoverability verification hasn't progressed past `sp_indexed`. |
| `success` | Piece was retrieved and verified with [standard IPFS tooling](https://github.com/filecoin-project/filecoin-pin/blob/master/documentation/glossary.md#standard-ipfs-tooling).  |
| `failure.timedout` | Piece wasn't retrieved and verified within the allotted time. |
| `failure.other` | Piece wasn't retrieved and verified for other reasons. |

Sources: 
- [`types.ts` (`DealStatus`)](../../apps/backend/src/database/types.ts#L1)
- [`types.ts` (`IpniStatus`)](../../apps/backend/src/database/types.ts#L28)

## Metrics Recorded

Metric definitions live in [Dealbot Events & Metrics](./events-and-metrics.md). 

## Configuration

Key environment variables that control deal creation behavior:

| Variable | Description |
|----------|-------------|
| `RANDOM_PIECE_SIZES` | Possible random file sizes in bytes for data-storage checks. See [`docs/environment-variables.md#random_piece_sizes`](../environment-variables.md#random_piece_sizes) for defaults and examples. |

Source: [`apps/backend/src/config/app.config.ts`](../../apps/backend/src/config/app.config.ts)

See also: [`docs/environment-variables.md`](../environment-variables.md) for the source-of-truth configuration reference.

## FAQ

### Why do we check filecoinpin.contact rather than cid.contact?

See https://github.com/filecoin-project/filecoin-pin/blob/master/documentation/content-routing-faq.md#why-is-there-filecoinpincontact-and-cidcontact

## TBD Summary

The following items are **TBD**.  This set will get reviewed and cleaned up as part of https://github.com/FilOzone/dealbot/issues/280.

| Item | Description |
|------|-------------|
| Inline retrieval verification | After SP indexes, immediately retrieve and verify content as part of the deal flow — deal must not be marked successful until retrieval passes (separate scheduled job until inline verification lands) |
| CID-based content verification | Verify retrieved content by re-computing CID and comparing to upload-time CID (size-check only until CID verification lands) |
| Per-deal max time limit | If the entire deal (all steps) does not complete within a configurable max time, mark the deal as failed. Operational timeouts prevent infinite runs but are not treated as a quality assertion that fails the deal. |
| Deal gated on all checks | Deal should not be marked successful until retrieval and IPNI verification pass (IPNI runs async until gating is implemented) |
| Status model update | Deal statuses may need new states to reflect retrieval and IPNI verification gates |
| `onPieceConfirmed` callback tracking | Track `onPieceConfirmed` callback as a distinct step — piece confirmed on-chain (only `onPieceAdded` is tracked as a deal status gate until this lands) |
| IPFS gateway retrieval verification | After SP indexes, retrieve content via the SP IPFS gateway (`/ipfs/{rootCid}`) and verify it before the deal can pass |
| `filecoin-pin` CAR conversion | CAR conversion should use the `filecoin-pin` library integration (local implementation in `ipni.strategy.ts` until this lands) |
