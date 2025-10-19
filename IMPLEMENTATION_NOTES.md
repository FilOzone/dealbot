# Implementation Notes: Testing All FWSS Service Providers

## Summary

Updated dealbot to test **ALL registered FWSS providers**, not just approved ones. This enabling self-service SP onboarding and pre-approval performance scoring.

## Key Changes

### 1. WalletSdkService
- Now fetches all SPs from the registry into `registeredProviders`.
- Tracks approved SPs separately via `approvedProviderIds` (a Set).

### 2. SchedulerService, DealService, RetrievalService
- Deal creation now tests ALL registered SPs
- Retrievals work for both approved and non-approved providers
- Updated log messages to reflect new behavior

## Breaking Change

⚠️ **`getProviderCount()` behavior changed:**
- **Before:** Count of approved providers only
- **After:** Count of ALL registered providers

Use `getApprovedProviderCount()` if you need the old behavior.

## Related Changes

- **Service Contracts:** Removed `approvedProviders` checks from `dataSetCreated()` and `storageProviderChanged()`
- **Issue [#291](https://github.com/FilOzone/filecoin-services/issues/291):** Any SPs can join FWSS; ApprovedProviders are FilOz's curated list for Synapse

