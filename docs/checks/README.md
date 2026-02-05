The set of files in this directory describe how dealbot works and how it is configured for production by the Filecoin Onchain Cloud working group, particularly for determining which SPs to approve for the "official" Filecoin Warm Storage Service contracts on calibration and mainnet. 

The files are:
- [data-storage.md](./data-storage.md): Defines the "data storage check" and how it is calculated.
- [retrievals.md](./retrievals.md): Defines the "retrieval check" and how it is calculated.
- [events-and-metrics.md](./events-and-metrics.md): Defines the events and metrics that are used to calculate the checks..
- [production-configuration-and-approval-methodology.md](./production-configuration-and-approval-methodology.md): Defines the production configuration and approval methodology.

## What is "DealBot"?

DealBot creates synthetic traffic for registered SP sand monitors success/failures.  It collects metrics from this traffic and computes stats for each SP.

## Terminology
* Deal - This is covered in the [data-storage.md](./data-storage.md).
* Check - A "check" refers to a job type that dealbot performs on a SP.  We currently have [Data Storage](./data-storage.md) and [Retrieval](./retrievals.md) checks.
* Cycle - A "cycle" refers to a specific instnace of running a "check" against all the appropriate SPs.  For example, if the Retrieval Check job is run against its configured SPs every 15 minutes, we would say it runs a cycle every 15 minutes..
* Batch - Some checks break the work for a cycle into smaller chunks.  For example, the Retrieval Check job may be configured to run 10 pieces at a time.  We would say it runs a batch of 10 pieces at a time and that multiple batches are necessary to complete the cycle for covering all the appropraite SPs.

## Where can I ask questions?

Please start with the `#fil-foc` channel on Filecoin Slack.  If you see an issue with Dealbot, please open an issue.