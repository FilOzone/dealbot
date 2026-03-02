The set of files in this directory describe how dealbot works and how it is configured for production by the Filecoin Onchain Cloud working group, particularly for determining which SPs to approve for the "official" Filecoin Warm Storage Service contracts on calibration and mainnet. 

The files are:
- [production-configuration-and-approval-methodology.md](./production-configuration-and-approval-methodology.md): Defines the production configuration and approval methodology.
- [data-storage.md](./data-storage.md): Defines the "data storage check" and how it is calculated.
- [retrievals.md](./retrievals.md): Defines the "retrieval check" and how it is calculated.
- [data-retention.md](./data-retention.md): Defines the "data retention check" and how it is calculated.
- [events-and-metrics.md](./events-and-metrics.md): Defines the events and metrics that are used to assess SP performance.


## What is "DealBot"?

DealBot creates synthetic traffic for SPs in the onchain SP registry and monitors success/failures.  It collects metrics from this traffic and computes stats for each SP for helping to determine which SPs are eligible for "approval" in Filecoin Warm Storage Service contracts on calibration and mainnet.

## Terminology
### Check
A "check" refers to a task type that dealbot performs on a SP.  We currently have [Data Storage](./data-storage.md) and [Retrieval](./retrievals.md) checks.

### Deal
This is synonym for "Data Storage Check".  This is covered in the [data-storage.md](./data-storage.md).
 
### Job
A "job" refers to a specific instance of running a "check" task against an SP.  Jobs gets scheduled to run at a specific rate based on the check type (e.g., data storage, retrieval), and they get scheduled for all SPs that have been configured for dealbot to test (e.g., only approved SPs, all SPs).  See [jobs.md](./jobs.md) for more details.

### SPs under test
This is the set of SPs that are configured for dealbot to test.  This is determined by configuration values as discussed in [jobs.md](./jobs.md).  Checks are run against each of these SPs by the dealbot scheduler scheduling jobs for each of the SPs at its configured rate.

## Job Scheduling
The dealbot scheduler schedules "* check jobs" for the set of SPs that have been discovered to meet the configuration criteria.  It schedules them at its configured rate.  See [jobs.md](./jobs.md) for more details.

## Datasets for Checks

Dealbot manages a set of datasets to use for its checks.  Creating these datasets is a precondition before the "data storage" check can run.  This is handled by **TBD** job ([tracking issue](https://github.com/FilOzone/dealbot/issues/284)) when it discovers a new SP to measure from the registry.
 - This is done via the Synapse SDK (`synapse.createStorage(...)`).
 - Dataset creation is idempotent.
 - The quantity per SP is controlled by [`MIN_NUM_DATASETS_FOR_CHECKS`](#MIN_NUM_DATASETS_FOR_CHECKS).  The usecase for setting this greater than one is if you want an SP to have more non-empty datasets.  This is most relevant for calculating data retention, which is a function of the number of onchain proofs, which scales with the number of datasets.

## Where can I ask questions?

Please start with the `#fil-foc` channel on Filecoin Slack.  If you see an issue with Dealbot, please open an issue.
