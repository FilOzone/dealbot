The set of files in this directory describe how dealbot works and how it is configured for production by the Filecoin Onchain Cloud working group, particularly for determining which SPs to approve for the "official" Filecoin Warm Storage Service contracts on calibration and mainnet. 

The files are:
- [production-configuration-and-approval-methodology.md](./production-configuration-and-approval-methodology.md): Defines the production configuration and approval methodology.
- [data-storage.md](./data-storage.md): Defines the "data storage check" and how it is calculated.
- [retrievals.md](./retrievals.md): Defines the "retrieval check" and how it is calculated.
- [events-and-metrics.md](./events-and-metrics.md): Defines the events and metrics that are used to assess SP performance.


## What is "DealBot"?

DealBot creates synthetic traffic for SPs in the onchain SP registry and monitors success/failures.  It collects metrics from this traffic and computes stats for each SP for helping to determine which SPs are eligible for "approval" Filecoin Warm Storage Service contracts on calibration and mainnet.

## Terminology
### Check
A "check" refers to a task type that dealbot performs on a SP.  We currently have [Data Storage](./data-storage.md) and [Retrieval](./retrievals.md) checks.

### Deal
This is synonym for "Data Storage Check".  This is covered in the [data-storage.md](./data-storage.md).
 
### Job
A "job" refers to a specific instance of running a "check" task against an SP.  Jobs gets scheduled to run at a specific rate based on the check type (e.g., data storage, retrieval), and they get scheduled for all SPs that have been configured for dealbot to test (e.g., only approved SPs, all SPs).

## Where can I ask questions?

Please start with the `#fil-foc` channel on Filecoin Slack.  If you see an issue with Dealbot, please open an issue.