## Purpose

This document outlines how dealbot is configured for production by the Filecoin Onchain Cloud working group, particularly for determining which SPs to approve for the "official" Filecoin Warm Storage Service contracts on calibration and mainnet.  A reader, especially an SP seeking to be approved for paid FOC storage deals by default, should be able to read this document and understand how they are evaluated.  While [data-storage.md](./data-storage.md), [retrievals.md](./retrievals.md), and [events-and-metrics.md](./events-and-metrics.md) discuss the dealbot checks and metrics in general, this document provides the context and background for how they are configured and used in production.

## Approval Acceptance Criteria

### Summary
Our goal in having an "approved" SP list is to support a production-grade quality of service for Filecoin Onchain Cloud storage.  In order to be an approved SP, one must satisfy all of the following criteria:

| Metric | Threshold | Minimum Sample Size |
|--------|-----------|---------------------|
| [Data Storage Success Rate](#data-storage-success-rate) | ≥ 97% | 200 |
| [Data Retention Fault Rate](#data-retention-fault-rate) | ≤ 0.2% | 500 |
| [Retrieval Success Rate](#retrieval-success-rate) | ≥ 97% | 200 |

### Data Storage Success Rate
This is calculated as the success rate of [Data Storage checks](./data-storage.md), which includes uploading data, indexing it, adding it onchain, and verifying it's publicly discoverable, retrievable, and verifiable with [standard IPFS tooling](https://github.com/filecoin-project/filecoin-pin/blob/master/documentation/glossary.md#standard-ipfs-tooling).  

Relevant parameters include:

| Parameter | Value | Notes |
|-----------|-------|-------|
| `NUM_DATA_STORAGE_CHECKS_PER_SP_PER_HOUR` | 4 | 96 per day |
| `MIN_NUM_DATASETS_FOR_CHECKS` | 15 | Ensure there are enough datasets with pieces being added so that statistical significance for [Data Retention Fault Rate](#data-retention-fault-rate) can be achieved quicker. |
| `RANDOM_PIECE_SIZES` | 10485760 | 10MB files are used for simplicity.  See [Why are 10MB files used for testing?](#why-are-10mb-files-used-for-testing) for more details. |
| Max [`ingestMs`](./events-and-metrics.md#ingestMs) | 20s | |
| Max [`pieceAddedOnChainMs`](./events-and-metrics.md#pieceAddedOnChainMs) | 60s | |
| Max [`pieceConfirmedOnChainMs`](./events-and-metrics.md#pieceConfirmedOnChainMs) | 60s | |
| Max [`spAnnounceAdvertisementMs`](./events-and-metrics.md#spAnnounceAdvertisementMs) | 20s | |
| Max [`ipniVerifyMs`](./events-and-metrics.md#ipniVerifyMs) | 60s | |
| Max [`ipfsRetrievalLastByteMs`](./events-and-metrics.md#ipfsRetrievalLastByteMs) | 20s | |
| Max [`dataStorageCheckMs`](./events-and-metrics.md#dataStorageCheckMs) | 180s | |

This minimum observed success rate threshold count is for having 95% confidence that the success rate is greater than 95%.  See [How are data storage and retrieval check statistics/thresholds calculated?](#how-are-data-storage-and-retrieval-check-statisticsthresholds-calculated) for more details.

### Data Retention Fault Rate
This is calculated by looking at all the dataset proofs on chain for the SPs and determining how many challenges were missed or failed.  Note that on mainnet each dataset incurs 5 challenges per day.  To help get to statistical significance quicker, dealbot will seed the SPs with `MIN_NUM_DATASETS_FOR_CHECKS=15` datasets.  This means an SP can be approved for data retention after a faultless ~7 days if the SP doesn't have other datasets.

See [How are data retention statistics/thresholds calculated?](#how-are-data-retention-statisticsthresholds-calculated) for more details.

### Retrieval Success Rate
This is calculated as the success rate of [Retrieval checks](./retrievals.md), which includes verifying that previously stored data is still publicly discoverable, retrievable, and verifiable with [standard IPFS tooling](https://github.com/filecoin-project/filecoin-pin/blob/master/documentation/glossary.md#standard-ipfs-tooling).   

Relevant parameters include:

| Parameter | Value | Notes |
|-----------|-------|-------|
| `NUM_RETRIEVAL_CHECKS_PER_SP_PER_HOUR` | 4 | 96 per day |
| `RANDOM_PIECE_SIZES` | `10485760` | Only ~10MB files are used for retrieval downloads, for simplicity |
| Max [`ipniVerifyMs`](./events-and-metrics.md#ipniVerifyMs) | 10s | |
| Max [`ipfsRetrievalLastByteMs`](./events-and-metrics.md#ipfsRetrievalLastByteMs) | 20s | |
| Max [`retrievalCheckMs`](./events-and-metrics.md#retrievalCheckMs) | 30s | |

This minimum observed success rate threshold count is for having 95% confidence that the success rate is greater than 95%.  See [How are data storage and retrieval check statistics/thresholds calculated?](#how-are-data-storage-and-retrieval-check-statisticsthresholds-calculated) for more details.

## SP Maintenance Window

Dealbot provides two 20 minute windows per day where it doesn't run "checks" so that SPs can plan their maintenance activities without having their dealbot scores impacted:
- 07:00-07:20 UTC
- 22:00-22:20 UTC

These times are on the end of the "global trough" and "early morning lull" respectively.  See issue [#163](https://github.com/FilOzone/dealbot/issues/163) for more details.

## SPs in Scope for Testing

The "production dealbot" has `USE_ONLY_APPROVED_PROVIDERS=false` so non-approved SPs are included for evaluation. This means approved and non-approved SPs are both included for evaluation.  Only "dev" or "inactive" SPs in the SP Registry are excluded from testing.

## SP Resource Consumption for Dealbot Checks

With the current configuration, Dealbot will add this much synthetic load on SPs:
- 15 datasets, requiring 5 challenges per day per dataset.  The dataset floor price that is paid by Dealbot to the SP covers the cost of the challenges.
- 4x10MB pieces being uploaded per hour.  
- 8x10MB pieces being downloaded per hour (the newly created pieces as part of the Data Storage checks and random existing pieces as part of the Retrieval checks)

Over the course of a day this means:
* 75 proof challenges
* 960 MB of SP download bandwidth in support of adding new pieces
* 960 MB of disk space for the pieces.
* 1,920 MB of SP upload bandwidth in support of retrievals

## Appendix

### Where is dealbot hosted?

`dealbot.filoz.org` runs from the EU.  It is a not a multi-region service.  As a result, any latency-related metrics will likely be biased towards EU SPs.  This is part of the reason why the [Approval Acceptance Criteria](#approval-acceptance-criteria) don't have strict latency requirements currently.

### Where is the configuration that the "production dealbot" uses?

This is in a private repo because it includes other infrastructure configuration that is not relevant to the public.  We are happy to answer any questions.

### Does dealbot cleanup old pieces?

No, not currently.  See issue [#284](https://github.com/FilOzone/dealbot/issues/284) for more details.

## How are data storage and retrieval check statistics/thresholds calculated?
TODO for researcher/PM/Steve (tracked in issue [#174](https://github.com/FilOzone/dealbot/issues/174)): fill this in covering things like
- 95% confidence level
- One sided confidence interval

## How are data retention statistics/thresholds calculated?
TODO for researcher/PM/Steve (tracked in issue [#174](https://github.com/FilOzone/dealbot/issues/174)): fill this in covering things like
- 95% confidence level
- One sided confidence interval
- It doesn't matter how much data is stored in a dataset
- DataSets beyond the ones created by dealbot factor in as samples.

## Why aren't there latency/throughput requirements?

Latency and throughput are not just a function of the SP's infrastructure.  They are also dependent on the node doing the retrieval checking and the link between them.  We aren't doing any multi-region probing currently, which is why the low bar has been set for retrieval testing of being able to retrieve a 10MB piece from an SP in 20 seconds.  

## Why are 10MB files used for testing?

10MB files are used for simplicity.  It's an approximation of a static website, which is a use case for Filecoin Onchain Cloud.  Until we have piece cleanup functionality, it was an easy way to not fill up SP disk space too rapidly.  It's also a better size for measuring SP throughput than smaller files.

## Why are we using the SP's `/ipfs` endpoint for retrieval testing?

We are using the SP's `/ipfs` for retrieval testing because it is the golden path.  We could mix other ways to retrieve the data (e.g., `/piece`, via CDM), but it would add more complexity to the dealbot code.  

