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

The approval thresholds are set at an **observed success rate of ≥ 97% over a minimum of 200 checks**.  The 97% observed rate and 200 sample minimum are intentionally simple numbers for SPs to reason about.  The underlying statistical goal is to have **95% confidence (one-sided) that the true success rate is greater than 95%, given an observed success rate of at least 97%**.

### Derivation of the 200-sample minimum

Using the normal approximation to a one-sided 95% confidence interval, the lower confidence bound on an observed proportion p̂ is:

```
p_lower = p̂ - Z_0.95 · sqrt(p̂(1 - p̂) / n)
```

Setting the target lower bound to 0.95, the observed rate p̂ = 0.97, and Z_0.95 = 1.645 (one-sided):

```
0.95 = 0.97 - 1.645 · sqrt(0.97 · 0.03 / n)
0.02 = 1.645 · sqrt(0.0291 / n)
sqrt(0.0291 / n) = 0.02 / 1.645 ≈ 0.01216
0.0291 / n = 0.0001478
n ≈ 197
```

This gives n ≈ 197, which is rounded up to **200** for convenience.

### Intuition

The 2 percentage point gap between the observed rate (97%) and the true-rate threshold (95%) is narrow, so a meaningful number of samples is required to make the confidence interval tight enough to rule out a true rate below 95%.  With only, say, ~50 samples, the error bars would be too wide to draw that conclusion.

## How are data retention statistics/thresholds calculated?

The approval threshold is set at a **fault rate of ≤ 0.2% over a minimum of 500 proof challenges**. The 0.2% observed rate and 500 sample minimum are intentionally simple numbers for SPs to reason about.  The underlying statistical goal is to have **95% confidence (one-sided) that the true fault rate is less than 1%, but allowing for up to 1 observed fault in the sample**.

### What counts as a sample

Each challenge on a dataset counts as one sample and there are 5 challenges each day for each dataset on mainnet, regardless of how much data is stored in that dataset.  Dealbot seeds each SP with `MIN_NUM_DATASETS_FOR_CHECKS=15` datasets to accumulate samples faster, but any datasets the SP holds beyond those 15 also contribute. With 500 samples needed, and at least 15 datasets providing 5 samples a day, an SP can get approved in less than 7 days.

### Derivation of the 500-sample minimum

With up to 1 allowed fault, the threshold is reached when the probability of observing 1 or fewer faults in n trials, assuming the true fault rate is exactly 1%, falls to 5% or below.  Using the binomial distribution:

```
P(X ≤ 1 | n, p = 0.01) = 0.99^n + n · 0.01 · 0.99^(n-1) ≤ 0.05
```

Factoring:

```
0.99^(n-1) · (0.99 + 0.01n) ≤ 0.05
```

Solving numerically:

| n   | P(≤ 1 fault \| p = 1%) |
|-----|------------------------|
| 300 | 19.9%                  |
| 400 | 9.2%                   |
| 450 | 6.1%                   |
| 470 | 5.3%                   |
| 480 | 4.9% ✓                 |

This gives n ≈ 480, which is rounded up to **500** for convenience.

### Why allow 1 fault?

Requiring zero faults would demand only ~300 samples (298 to be precise), but a single transient fault - for example a missed proof due to a brief infrastructure hiccup rather than a genuine data retention problem - would permanently disqualify an otherwise reliable SP.  Allowing 1 fault while requiring ~500 samples gives SPs reasonable tolerance for one-off issues while still demanding strong evidence of reliability.

### Intuition

Each fault you permit requires significantly more evidence to still conclude the SP is reliable.  The 60% increase in required samples (298 → 480) reflects the extra "benefit of the doubt" granted by the 1-fault allowance.

## Why aren't there latency/throughput requirements?

Latency and throughput are not just a function of the SP's infrastructure.  They are also dependent on the node doing the retrieval checking and the link between them.  We aren't doing any multi-region probing currently, which is why the low bar has been set for retrieval testing of being able to retrieve a 10MB piece from an SP in 20 seconds.  

## Why are 10MB files used for testing?

10MB files are used for simplicity.  It's an approximation of a static website, which is a use case for Filecoin Onchain Cloud.  Until we have piece cleanup functionality, it was an easy way to not fill up SP disk space too rapidly.  It's also a better size for measuring SP throughput than smaller files.

## Why are we using the SP's `/ipfs` endpoint for retrieval testing?

We are using the SP's `/ipfs` for retrieval testing because it is the golden path.  We could mix other ways to retrieve the data (e.g., `/piece`, via CDM), but it would add more complexity to the dealbot code.  

