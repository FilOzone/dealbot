## Purpose

This document outlines how dealbot is configured for production by the Filecoi Onchain Cloud working group, particularly for determining which SPs to approve for the "official" Filecoin Warm Storage Service contracts on calibration and mainnet.  A reader, especially an SP seeking to be approved for paid FOC storage deals by default, should be able to read this document and understand how they are evaluated.  While [data-storage.md](./data-storage.md), [retrievals.md](./retrievals.md), and [events-and-metrics.md](./events-and-metrics.md) discussed the dealbot checks and metrics in general, this document provides the context and background for how they are configured and used in production.

## What is "DealBot"?

DealBot creates synthetic traffic for registered SP sand monitors success/failures.  It collects metrics from this traffic and computes stats for each SP.

## Approval Acceptance Criteria

Our goal in have an "approved" SP list to support a production-grade quality of service for Filecoin Onchain Cloud storage.  In order to be an approved SP, one must satisfy all of the following criteria. 

| Metric | Threshold | Minimum Sample Size |
|--------|-----------|---------------------|
| [Data Storage Success Rate](#data-storage-success-rate)| ≥ 97% | 200 |
| [Data Retention Fault Rate](#data-retention-fault-rate) | ≤ 0.2% | 500 |
| [Retrieval Success Rate](#retrieval-success-rate) | ≥ 97% | 200 |

### Data Storage Success Rate
This is calculated as the success rate of [Data Storage checks](./data-storage.md), which includes uploading data, indexing it, adding it onchain, and verifying it publicly discoverable,retrievable, and verifiable with [standard IPFS tooling](https://github.com/filecoin-project/filecoin-pin/blob/master/documentation/glossary.md#standard-ipfs-tooling).  

Relevant parameters include:

| Parameter | Value | Notes |
|-----------|-------|-------|
| `RANDOM_PIECE_SIZES` | `10485760` | 10MB files are used for simplicity |
| Max [`ingestMs`](./events-and-metrics.md#ingestMs) | 20s | |
| Max [`pieceConfirmedOnChainMs`](./events-and-metrics.md#pieceConfirmedOnChainMs) | 60s | |
| Max [`spAnnounceAdvertisementMs`](./events-and-metrics.md#spAnnounceAdvertisementMs) | 20s | |
| Max [`ipniVerifyMs`](./events-and-metrics.md#ipniVerifyMs) | 60s | |
| Max [`ipfsRetrievalLastByteMs`](./events-and-metrics.md#ipfsRetrievalLastByteMs) | 20s | |
| Max [`dataStorageCheckMs`](./events-and-metrics.md#dataStorageCheckMs) | 120s | |

This minimum observed success rate threshold count is for having 95% confidence that the success rater is greater than 95%.  See ["How were data storage and retrieval statistics calculated?"](#how-were-data-storage-and-retrieval-statistics-calculated) for more details.

### Data Retention Fault Rate
Data Retention Fault Rate: You must achieve an observed fault rate of less than 0.2% over the last 7 days with at least 500 challenges made. You will be seeded with 15 datasets when you first join. Each dataset faces 5 challenges per day. This means you can be approved for durability after a faultless ~7 days.

### Retrieval Success Rate
This is calculated as the success rate of [Retrieval checks](./retrievals.md), which includes verifying that previously stored data is still publicly discoverable, retrievable, and verifiable with [standard IPFS tooling](https://github.com/filecoin-project/filecoin-pin/blob/master/documentation/glossary.md#standard-ipfs-tooling).   

Relevant parameters include:

| Parameter | Value | Notes |
|-----------|-------|-------|
| `RANDOM_PIECE_SIZES` | `10485760` | Only download ~10MB files are used for simplicity |
| Max [`ipniVerifyMs`](./events-and-metrics.md#ipniVerifyMs) | 10s | |
| Max [`ipfsRetrievalLastByteMs`](./events-and-metrics.md#ipfsRetrievalLastByteMs) | 20s | |
| Max [`dataStorageCheckMs`](./events-and-metrics.md#dataStorageCheckMs) | 30s | |

This minimum observed success rate threshold count is for having 95% confidence that the success rater is greater than 95%.  See ["How were data storage and retrieval statistics calculated?"](#how-were-data-storage-and-retrieval-statistics-calculated) for more details.

## Goal of Approving SPs



This means:
1. Successfully storing data
2. Successfully retrieving data
3. Proving proof of possession on-chain



## What does it mean to successfully store data?

A successful Data Storage operation requires passing the [Data Storage Check](./data-storage.md), which includes receiving data, indexing it, adding it onchain, and verifying it publicly discoverable and retrievable with [standard IPFS tooling](https://github.com/filecoin-project/filecoin-pin/blob/master/documentation/glossary.md#standard-ipfs-tooling).

## What does it mean to successfully retrieve data?

A successful retrieval requires passing the [Retrieval Check](./retrievals.md), which includes verifying that previously stored data is still publicly discoverable and retrievable with [standard IPFS tooling](https://github.com/filecoin-project/filecoin-pin/blob/master/documentation/glossary.md#standard-ipfs-tooling).


What is the SLA expected?

Our goal is to have >=95% success rate for both data storage and data retrieval.

This means successfully storing data and for retrieving data >=97% out of 200 samples (which gives us 95% confidence).

Successfully demonstrating data possession means >=98%  out of 150 proofs.

We are also evaluating latency (TTLB for a 10MB payload) but aren't yet defining the threshold.

What does it mean to successfully store data?

A successful Data Storage operation requires ALL of:

XFN-212SP confirms receipt and piece lands on-chain within ~2 minutes (typical: 1m 52s based on current metrics)

XFN-213 (confirms SP indexed the data)

If ANY of these criteria fail, the Data Storage operation fails.

## Where dealbot is hosted

`dealbot.filoz.org` runs from the EU.  It is a not a multi-region service.  As a result, any latency-related metrics will likely be biased towards EU SPs.  This is part of the reason why the [Approval Acceptance Criteria](#approval-acceptance-criteria) don't have strict latency requirements currently.



TTLB is at most 20 seconds including retries (file size is 10MB)

with `USE_ONLY_APPROVED_PROVIDERS=false` so non-approved SPs are included for evaluation. The default remains `true` for safety in self-hosted deployments.

MAX_RETRIEVAL_CHECKS_PER_SP_PER_CYCLE

## Maintencne

## How were data storage and retrieval statistics calculated?

## Why aren't there latency/throughput requirements?