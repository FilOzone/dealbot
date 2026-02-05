## Purpose

This document outlines how dealbot is configured for production by the Filecoin Onchain Cloud working group, particularly for determining which SPs to approve for the "official" Filecoin Warm Storage Service contracts on calibration and mainnet.  A reader, especially an SP seeking to be approved for paid FOC storage deals by default, should be able to read this document and understand how they are evaluated.  While [data-storage.md](./data-storage.md), [retrievals.md](./retrievals.md), and [events-and-metrics.md](./events-and-metrics.md) discussed the dealbot checks and metrics in general, this document provides the context and background for how they are configured and used in production.



## Approval Acceptance Criteria

Our goal in having an "approved" SP list is to support a production-grade quality of service for Filecoin Onchain Cloud storage.  In order to be an approved SP, one must satisfy all of the following criteria. 

| Metric | Threshold | Minimum Sample Size |
|--------|-----------|---------------------|
| [Data Storage Success Rate](#data-storage-success-rate) | ≥ 97% | 200 |
| [Data Retention Fault Rate](#data-retention-fault-rate) | ≤ 0.2% | 500 |
| [Retrieval Success Rate](#retrieval-success-rate) | ≥ 97% | 200 |

### Data Storage Success Rate
This is calculated as the success rate of [Data Storage checks](./data-storage.md), which includes uploading data, indexing it, adding it onchain, and verifying it publicly discoverable, retrievable, and verifiable with [standard IPFS tooling](https://github.com/filecoin-project/filecoin-pin/blob/master/documentation/glossary.md#standard-ipfs-tooling).  

See ["How are data storage and retrieval check statistics/thresholds calculated?"](#how-are-data-storage-and-retrieval-check-statisticsthresholds-calculated) for more details.

Relevant parameters include:

| Parameter | Value | Notes |
|-----------|-------|-------|
| [Data Storage Check](./data-storage.md) frequency | Once per 15 minutes | 96 per day |
| `MIN_NUM_DATASETS_FOR_CHECKS` | 15 | Ensure there are enough datasets with pieces being added so that statistical significance for [Data Retention Fault Rate](#data-retention-fault-rate) can be achieved quicker. |
| `RANDOM_PIECE_SIZES` | 10485760 | 10MB files are used for simplicity |
| Max [`ingestMs`](./events-and-metrics.md#ingestMs) | 20s | |
| Max [`pieceConfirmedOnChainMs`](./events-and-metrics.md#pieceConfirmedOnChainMs) | 60s | |
| Max [`spAnnounceAdvertisementMs`](./events-and-metrics.md#spAnnounceAdvertisementMs) | 20s | |
| Max [`ipniVerifyMs`](./events-and-metrics.md#ipniVerifyMs) | 60s | |
| Max [`ipfsRetrievalLastByteMs`](./events-and-metrics.md#ipfsRetrievalLastByteMs) | 20s | |
| Max [`dataStorageCheckMs`](./events-and-metrics.md#dataStorageCheckMs) | 120s | |

This minimum observed success rate threshold count is for having 95% confidence that the success rate is greater than 95%.  See ["How are data storage and retrieval check statistics/thresholds calculated?"](#how-are-data-storage-and-retrieval-check-statisticsthresholds-calculated) for more details.

### Data Retention Fault Rate
This is calculated by looking at all the dataset proofs on chain for the SPs and determining how many challenges were missed or failed.  Note that on mainnet each dataset incurs 5 challenges per day.  To help get to statistical significance quicker, dealbot will seed the SPs with 15 datasets.  Each dataset faces 5 challenges per day. This means you can be approved for durability after a faultless ~7 days.

See ["How are data retention statistics/threshold calculated?"](#how-are-data-retention-statisticsthreshold-calculated) for more details.

### Retrieval Success Rate
This is calculated as the success rate of [Retrieval checks](./retrievals.md), which includes verifying that previously stored data is still publicly discoverable, retrievable, and verifiable with [standard IPFS tooling](https://github.com/filecoin-project/filecoin-pin/blob/master/documentation/glossary.md#standard-ipfs-tooling).   

Relevant parameters include:

| Parameter | Value | Notes |
|-----------|-------|-------|
| [Retrieval Check](./retrievals.md) frequency | Once per 15 minutes | 96 per day |
| `RANDOM_PIECE_SIZES` | `10485760` | Only ~10MB files are used for retrieval downloads, for simplicity |
| `MAX_RETRIEVAL_CHECKS_PER_SP_PER_CYCLE` | 1 |  |
| Max [`ipniVerifyMs`](./events-and-metrics.md#ipniVerifyMs) | 10s | |
| Max [`ipfsRetrievalLastByteMs`](./events-and-metrics.md#ipfsRetrievalLastByteMs) | 20s | |
| Max [`retrievalCheckMs`](./events-and-metrics.md#retrievalCheckMs) | 30s | |

This minimum observed success rate threshold count is for having 95% confidence that the success rate is greater than 95%.  See ["How are data storage and retrieval check statistics/thresholds calculated?"](#how-are-data-storage-and-retrieval-check-statisticsthresholds-calculated) for more details.

## SP Maintenance Window

Dealbot provides two 20 minute windows per day where it doesn't run "checks" so that SPs can plan their maintenance activities without having their dealbot scores impacted:
1. 07:00-07:20 UTC
2. 22:00-22:20 UTC

These times are on the end of the "global trough" and "early morning lull" respectively.  See issue [#163](https://github.com/filecoin-project/dealbot/issues/163) for more details.

## SPs in Scope for Testing

The "production dealbot" has `USE_ONLY_APPROVED_PROVIDERS=false` so non-approved SPs are included for evaluation. This means approved and non-approved SPs are both included for evaluation.  Only "dev" SPs in the SP Registry are excluded from testing.

## SP Resource Consumption for Dealbot Checks

With the current configuration, Dealbot will add this much synthetic load on SP's:
- 15 datasets, requiring 5 challenges per day per dataset.  The dataset floor price that is paid by Dealbot to the SP covers the cost of the challenges.
- One 10MB piece being uploaded per 15 minutes.  
- Two 10MB pieces being downloaded per 15 minutes (the newly create piece and a random existing one)

Over the course of a day this means:
* 75 proof challenges
* 960 MB of SP download bandwidth in support of adding new pieces
* 860 MB of disk space for the pieces.
* 1,920 MB of SP upload bandwidth in support of retrievals

## Appendix

### Where is dealbot hosted?

`dealbot.filoz.org` runs from the EU.  It is a not a multi-region service.  As a result, any latency-related metrics will likely be biased towards EU SPs.  This is part of the reason why the [Approval Acceptance Criteria](#approval-acceptance-criteria) don't have strict latency requirements currently.

### Where is the configuration that the "production dealbot" uses?

This is in a private repo because it includes other infrastructure configuration that is not relevant to the public.  We are happy to answer any questions.

### Does dealbot cleanup old pieces?

No, not currently.  TODO: link to backlog item for this.

## How are data storage and retrieval check statistics/thresholds calculated?
TODO: fill this in covering things like
- 95% confidence level
- One sided confidence interval

## How are data retention statistics/threshold calculated?
TODO: fill this in covering things like
- 95% confidence level
- One sided confidence interval
- It doesn't matter how much data is stored in a dataset
- DataSets beyond the ones created by dealbot factor in as samples.

## Why aren't there latency/throughput requirements?

Latency and throughput are not just a function of the SP's infrastructure.  They are also a function of the node doing the retrieval checking and the link between them.  We aren't doing any multi-region probing currently, which is why the low bar has been set for retrieval testing of being able to retrieve a 10MB piece from an SP in 20 seconds.  

## Why are 10MB files used for testing?

10MB files are used for simplicity.  It's an approximation of a static website, which is a usecase for Filecoin Onchain Cloud.  Until we have piece cleanup functionality, it was an easy way to not fill up SP disk space too rapidly.

## Why are we using the SP's IPFS gateway for retrieval testing?

We are using the SP's IPFS gateway for retrieval testing because it is the most common way that SPs serve data to the public.  We could use other ways to retrieve the data, but it would add more complexity to the dealbot code and the SPs would need to be able to handle other ways to retrieve the data.  We could also use a mix of ways to retrieve the data, but it would add more complexity to the dealbot code and the SPs would need to be able to handle a mix of ways to retrieve the data.  The SP's IPFS gateway is a good compromise between complexity and SP resource consumption.

