# Wallet and Session Key Management

DealBot uses a Safe multisig wallet with a session key for delegated signing. This reduces blast radius (session keys are scoped and time-limited) and ensures no single person controls the wallet.

* [Overview](#overview)
* [Environment Variables](#environment-variables)
* [Creating a Session Key](#creating-a-session-key)
  * [Prerequisites](#prerequisites)
  * [Step 1: Generate the session key and Safe calldata](#step-1-generate-the-session-key-and-safe-calldata)
  * [Step 2: Submit the registration transaction via Safe](#step-2-submit-the-registration-transaction-via-safe)
  * [Step 3: Collect signatures](#step-3-collect-signatures)
  * [Step 4: Deploy the session key to DealBot](#step-4-deploy-the-session-key-to-dealbot)
  * [Step 5: Verify](#step-5-verify)
* [Renewing a Session Key](#renewing-a-session-key)
* [Payment Setup](#payment-setup)
  * [Funding the multisig](#funding-the-multisig)
  * [Depositing and approving via Safe](#depositing-and-approving-via-safe)
  * [Checking account status](#checking-account-status)
* [Automated SP Cleanup](#automated-sp-cleanup)
  * [sp_dataset_pruning](#sp_dataset_pruning)
  * [abandoned_dataset_sweep](#abandoned_dataset_sweep)
  * [Resolving a stuck rail settlement](#resolving-a-stuck-rail-settlement)
  * [Operational prerequisite: session key gas balance](#operational-prerequisite-session-key-gas-balance)
* [Cleaning Up the Old Wallet](#cleaning-up-the-old-wallet)


## Overview

- **Multisig wallet**: A Safe (safe.filecoin.io) 2-of-N multisig that owns the funds and datasets. Requires multiple signers for any direct wallet operation (deposits, operator approvals, etc.).
- **Session key**: A regular Ethereum keypair registered on the SessionKeyRegistry contract with scoped permissions. DealBot uses this key for day-to-day storage operations without needing multisig approval for each transaction.

Multisig addresses and signers are documented in the [FOC Operational Excellence](https://www.notion.so/filecoindev/FOC-Operational-Excellence-2b7dc41950c1802aa432fff8ecb801cc#2fddc41950c180749b96e4ddc0fb6aaf) Notion page. The Safe UI is at [safe.filecoin.io](https://safe.filecoin.io/).

## Environment Variables

| Variable | Required | Secret | Description |
|----------|----------|--------|-------------|
| `WALLET_ADDRESS` | Yes | No | The multisig wallet address (same on both networks) |
| `SESSION_KEY_PRIVATE_KEY` | Yes (session key mode) | Yes | The session key's private key |
| `WALLET_PRIVATE_KEY` | No (session key mode) | Yes | Not needed when using a session key |
| `RPC_URL` | No | Yes | Authenticated RPC endpoint (contains API key) |

In session key mode, `SESSION_KEY_PRIVATE_KEY` provides the signing key and `WALLET_PRIVATE_KEY` is not needed. The multisig has no single private key, it's controlled by its signers via the Safe UI.

See [environment-variables.md](../environment-variables.md) for full documentation of all env vars.

## Creating a Session Key

### Prerequisites

- Node.js 22+
- This repository checked out (`apps/backend/scripts/create-session-key-safe.mjs` is the generation script)
- Being a signer on the DealBot Safe multisig

### Step 1: Generate the session key and Safe calldata

From `apps/backend/` in this repository:

```bash
node scripts/create-session-key-safe.mjs \
  --network calibration \
  --expiry-days 90
```

For mainnet:

```bash
node scripts/create-session-key-safe.mjs \
  --network mainnet \
  --expiry-days 90
```

To reuse an existing session key (e.g. for renewal):

```bash
node scripts/create-session-key-safe.mjs \
  --network mainnet \
  --expiry-days 90 \
  --session-key 0x<existing-private-key>
```

The script outputs:
1. The session key address and private key
2. Permission hashes being registered (CreateDataSet, AddPieces, SchedulePieceRemovals, TerminateService)
3. Safe transaction details: target contract address and ABI-encoded calldata
4. Verification: the decoded calldata for human review before submission
5. The `SESSION_KEY_PRIVATE_KEY` env var value for deployment

**Save the session key private key securely.** It will be needed for the SOPS secrets in FilOzone/infra.

### Step 2: Submit the registration transaction via Safe

1. Go to [safe.filecoin.io](https://safe.filecoin.io/) and open the DealBot multisig
2. **New Transaction** > **Transaction Builder**
3. Enter the **target contract address** (SessionKeyRegistry) from the script output
4. Select **Custom data (hex encoded)**
5. Paste the **calldata** from the script output
6. Set **Value** to `0`
7. **Create Batch** > **Send Batch**
8. Review the transaction details, sign it

### Step 3: Collect signatures

The multisig requires 2-of-N signatures. After you sign, another signer must also approve and execute the transaction via the Safe UI.

### Step 4: Deploy the session key to DealBot

Update the SOPS-encrypted secrets in [FilOzone/infra](https://github.com/FilOzone/infra) for the target environment. See the [infra dealbot runbook](https://github.com/FilOzone/infra/blob/main/docs/runbooks/dealbot.md#8-secrets-management) for SOPS editing instructions.

Values to set:
- `WALLET_ADDRESS`: the multisig address
- `SESSION_KEY_PRIVATE_KEY`: the session key private key from Step 1
- `WALLET_PRIVATE_KEY`: can be removed or left empty
- `RPC_URL`: the authenticated RPC endpoint (if not already set)

After committing the secrets, restart the DealBot pods to pick up the new values:

```bash
kubectl --context $CONTEXT rollout restart deployment -n dealbot -l app.kubernetes.io/part-of=dealbot
```

### Step 5: Verify

Check the DealBot logs for successful initialization:

```bash
kubectl --context $CONTEXT -n dealbot logs deployment/dealbot --tail=50 | grep synapse
```

Look for `synapse_initialization` and `bootstrap_listen_complete` events without errors.

## Renewing a Session Key

Session keys expire. The expiry is set during registration (default: 90 days). To renew:

1. Run the generation script with `--session-key 0x<existing-key>` and a new `--expiry-days`
2. Submit the new calldata via Safe (same process as initial creation)
3. No DealBot restart needed, the session key private key hasn't changed, only the on-chain expiry

Monitor expiry dates. A session key that expires while DealBot is running will cause all storage operations to fail.

## Payment Setup

Session keys can only perform scoped storage operations (create datasets, add pieces, schedule removals, terminate service). They cannot:

- Deposit USDFC into Filecoin Pay
- Approve FWSS as an operator
- Withdraw funds

These must be done from the multisig via a Safe batch transaction. The multisig needs:

1. **USDFC tokens** in its wallet (ERC20 balance, not Filecoin Pay balance)
2. **USDFC deposited** into Filecoin Pay
3. **FWSS approved** as an operator with maxUint256 allowances

### Funding the multisig

The multisig must hold USDFC tokens (ERC20 balance) before the deposit batch can execute. Transfer USDFC to the multisig address from any wallet that holds USDFC.

### Depositing and approving via Safe

From `apps/backend/` in this repository, generate the Safe batch calldata:

```bash
node scripts/fund-safe.mjs \
  --network calibration \
  --amount 50 \
  --wallet-address <MULTISIG_ADDRESS>
```

For mainnet:

```bash
node scripts/fund-safe.mjs \
  --network mainnet \
  --amount 50 \
  --wallet-address <MULTISIG_ADDRESS>
```

This outputs a 3-transaction batch:
1. **USDFC.approve**: allow FilecoinPay to pull tokens
2. **FilecoinPay.deposit**: move tokens into the Filecoin Pay account
3. **FilecoinPay.setOperatorApproval**: approve FWSS with maxUint256 allowances

Submit all three as a batch in the Safe Transaction Builder at [safe.filecoin.io](https://safe.filecoin.io/), then collect the required signatures.

**Note:** If the multisig already has FWSS approved (e.g. from a previous deposit), transaction 3 is a no-op but harmless to include.

## Automated SP Cleanup

Two global pg-boss jobs (one schedule row per network, not per-SP) keep dealbot's wallet from accumulating
leftover data sets that cost money without providing value: blocked/deprioritized SPs (dealbot#681, #689,
infra#366) and permanently unreachable SPs (dealbot#605). Both are described in `apps/backend/src/sp-cleanup/sp-cleanup.service.ts`.

### `sp_dataset_pruning`

Runs every `<NET>_DATASET_PRUNING_INTERVAL_SECONDS` (default 1 day, see
[environment-variables.md](../environment-variables.md#net_dataset_pruning_interval_seconds)). For every
**reachable** SP this handles cleanup fully automatically, no human involved:

- For each blocked SP (`<NET>_BLOCKED_SP_IDS` / `<NET>_BLOCKED_SP_ADDRESSES`): terminates every active dealbot
  data set down to 0.
- For every other SP — trickle-tier and full-rate alike — terminates the excess once the active count exceeds
  its tier's target (`trickleTierRates.minNumDataSetsForChecks` or `<NET>_MIN_NUM_DATASETS_FOR_CHECKS`) by more
  than `<NET>_EXCESS_DATASET_BUFFER` (default 5). This is a safety net independent of *why* a provider
  over-accumulated (e.g. a data-set-reuse bug in `provisionNextMissingDataSet`) — it caps the damage without
  needing that root cause fixed first.

Termination uses the same provider-relay path as the data-set lifecycle check (`terminateServiceSync`): dealbot
signs an EIP-712 authorization and POSTs it to the SP's own server, which submits the on-chain tx. This only
works for a **cooperative** SP — a dead/unreachable SP will fail every attempt. That's expected: the job logs
and counts the failure (`sp_termination_attempts_total{outcome="failure"}`) and moves on to the next data set
without aborting the batch. Dead SPs are cleaned up by `abandoned_dataset_sweep` instead.

### `abandoned_dataset_sweep`

Runs every `<NET>_ABANDONED_DATASET_SWEEP_INTERVAL_SECONDS` (default 1 day). Stateless and network-wide — scans
dealbot's entire wallet, not scoped to the blocklist. For each data set:

- **Abandoned** (never terminated, and outside PDPVerifier's ~30-day activity window since the last proof):
  `PDPVerifier.deleteDataSet` becomes fully permissionless once that window has elapsed, so dealbot's session
  key calls it **directly** — no signature, no SP cooperation required. This is what actually cleans up dead SPs.
- **Stuck settlement** (terminated, but the termination lockup has fully elapsed and the SP never called
  `settleRail()` themselves): unlike `settleTerminatedRailWithoutValidation` (`onlyRailClient` — the Safe's
  address only, not the session key's own; same constraint as the direct 1-arg `terminateService`, see
  dealbot#546), plain `settleRail()` has **no caller restriction at all**, so dealbot's session key calls it
  directly first. This resolves the common case — an SP that terminated cooperatively but just never bothered
  to settle themselves — with no human involved. Only when `settleRail()` itself reverts (the validator is
  genuinely stuck, e.g. an unresolvable open proving period) does it fall through to needing a human with the
  Safe's `settleTerminatedRailWithoutValidation` escape hatch. Expected to be rare.

### Resolving a stuck rail settlement

There is no database table or endpoint for this — the stuck set is fully re-derivable on-chain every run, so
it's recomputed fresh and logged in full each time it's non-empty (event `stuck_terminations_detected`). The
`sp_termination_stuck_gauge{network}` metric (reset every run, even to 0) is what a BetterStack/Grafana alert
rule thresholds on to page a human; the log is the payload you retrieve *after* being paged.

1. In BetterStack, search for `event:stuck_terminations_detected` on the relevant network, and open the most
   recent occurrence.
2. Copy the `batch` field's JSON value — it's a ready-to-use Safe Transaction Builder batch: one
   `settleTerminatedRailWithoutValidation(railId)` call per stuck rail, `to` = the network's FilecoinPay
   contract address, `value` = `"0"`, `data` = the pre-encoded calldata.
3. Save it to a `.json` file.
4. Go to [safe.filecoin.io](https://safe.filecoin.io/), open the DealBot multisig, **New Transaction** >
   **Transaction Builder**, and drag-and-drop the file in (same flow as [Depositing and approving via
   Safe](#depositing-and-approving-via-safe) above).
5. Review the decoded transactions, **Create Batch** > **Send Batch**, sign, and collect the second signature.

### Operational prerequisite: session key gas balance

Unlike the provider-relay path (where the SP's server pays gas for the on-chain tx it submits),
`abandoned_dataset_sweep`'s direct `deleteDataSet` calls are signed and broadcast by dealbot's own session key,
which pays its own gas in native FIL/tFIL.

The existing `wallet_balance{currency="FIL"}` Prometheus gauge (see
`apps/backend/src/metrics-prometheus/wallet-balance.collector.ts`) already covers this: `paymentsService.walletBalance()`
queries `this._client.account.address` — in session-key mode that *is* the session key, not the multisig (the
multisig's FilecoinPay balance is the separate `accountInfo()` call, surfaced as `wallet_balance{currency="USDFC"}`).
If the session key's wallet runs dry, `abandoned_dataset_sweep`'s writes will fail with an
out-of-gas/insufficient-funds error (logged and counted as
`sp_termination_attempts_total{reason="abandonment",outcome="failure"}`, retried next sweep) until it's topped up —
watch the existing `wallet_balance{currency="FIL"}` gauge and top it up with a small amount of FIL/tFIL as needed.

## Cleaning Up the Old Wallet

After migrating to the multisig, the old wallet's datasets should be terminated to stop streaming payments and recover lockup. This is tracked in [dealbot#111](https://github.com/FilOzone/dealbot/issues/111).
