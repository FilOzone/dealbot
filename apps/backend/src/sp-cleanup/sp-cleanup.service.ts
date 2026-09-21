import { asChain } from "@filoz/synapse-core/chains";
import { ZodValidationError } from "@filoz/synapse-core/errors";
import { settleRailCall, settleTerminatedRailWithoutValidationCall } from "@filoz/synapse-core/pay";
import { findMatchingDataSets, getDataSet, getPdpDataSets, type PdpDataSet } from "@filoz/synapse-core/warm-storage";
import type { Synapse } from "@filoz/synapse-sdk";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import type { Counter, Gauge } from "prom-client";
import type { Chain, Client, Transport } from "viem";
import { ContractFunctionRevertedError, encodeFunctionData } from "viem";
import {
  getBlockNumber,
  getTransactionCount,
  multicall,
  readContract,
  simulateContract,
  waitForTransactionReceipt,
  writeContract,
} from "viem/actions";
import { awaitWithAbort } from "../common/abort-utils.js";
import { LIFECYCLE_CHECK_METADATA_KEY } from "../common/constants.js";
import { getBaseDataSetMetadata, storedSlotMetadata } from "../common/data-set-slots.js";
import { toStructuredError } from "../common/logging.js";
import { mapWithConcurrency } from "../common/map-with-concurrency.js";
import { withSafeBatchChecksum } from "../common/safe-batch.js";
import { isSpBlocked } from "../common/sp-blocklist.js";
import { isFullRateTier } from "../common/sp-tier.js";
import { createSynapseFromConfig } from "../common/synapse-factory.js";
import type { Network } from "../common/types.js";
import { trickleTierRates } from "../config/constants.js";
import type { IConfig, INetworkConfig } from "../config/index.js";
import { terminateServiceSync } from "../data-set-lifecycle/data-set-lifecycle.service.js";
import { StorageProviderRepository } from "../providers/repositories/storage-provider.repository.js";
import type { SynapseViemClient } from "../wallet-sdk/wallet-sdk.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";

/**
 * `PDPVerifier.INACTIVITY_WINDOW` — the number of blocks after the last proven
 * epoch during which `deleteDataSet` still requires `msg.sender == sp`. Past
 * this window `deleteDataSet` is fully permissionless. ~30 days at ~1 block/30s.
 */
const PDP_INACTIVITY_WINDOW_BLOCKS = 86400n;

type TerminationReason = "blocked" | "trickle" | "full_rate" | "abandonment" | "settlement";
type TerminationOutcome = "success" | "failure";

type ReadOnlyClient = Client<Transport, Chain>;

type SubmitWithNonce = (submit: (nonce: number) => Promise<`0x${string}`>) => Promise<`0x${string}`>;

interface StuckRailItem {
  dataSetId: bigint;
  spAddress: string;
  railId: bigint;
}

// Conservative Multicall3 size; larger batches can exceed node gas limits.
const READ_BATCH_SIZE = 100;

// Bounds relay fan-out across providers.
const PROVIDER_CONCURRENCY = 10;

// Bounds relay traffic to one provider.
const RELAY_CONCURRENCY = 5;

// Bounds pending writes; transaction submission itself is nonce-serialized.
const WRITE_CONCURRENCY = 10;

@Injectable()
export class SpCleanupService {
  private readonly logger = new Logger(SpCleanupService.name);

  constructor(
    private readonly configService: ConfigService<IConfig, true>,
    private readonly walletSdkService: WalletSdkService,
    private readonly storageProviderRepository: StorageProviderRepository,
    @InjectMetric("sp_termination_attempts_total")
    private readonly spTerminationAttemptsCounter: Counter,
    @InjectMetric("sp_termination_stuck_gauge")
    private readonly spTerminationStuckGauge: Gauge,
  ) {}

  private getNetworkConfig(network: Network): INetworkConfig {
    return this.configService.get("networks")[network];
  }

  private async createSynapseInstance(network: Network): Promise<Synapse> {
    const { synapse } = await createSynapseFromConfig(this.getNetworkConfig(network));
    return synapse;
  }

  private async getSynapse(network: Network): Promise<Synapse> {
    const existing = this.walletSdkService.tryGetSynapse(network);
    if (existing) return existing;
    try {
      return await this.createSynapseInstance(network);
    } catch (error) {
      this.logger.error({
        network,
        event: "synapse_init_failed",
        message: "Failed to create Synapse instance for SP cleanup",
        error: toStructuredError(error),
      });
      throw error;
    }
  }

  private recordAttempt(network: Network, reason: TerminationReason, outcome: TerminationOutcome): void {
    this.spTerminationAttemptsCounter.inc({ network, outcome, reason });
  }

  /**
   * Serializes submission so concurrent writes use distinct nonces while receipts wait in parallel.
   * A failed submission resyncs from pending state; a failed resync forces the next caller to retry it.
   */
  private async createNonceAllocator(writeClient: SynapseViemClient, signal?: AbortSignal): Promise<SubmitWithNonce> {
    const fetchPendingNonce = () =>
      awaitWithAbort(
        getTransactionCount(writeClient, { address: writeClient.account.address, blockTag: "pending" }),
        signal,
      );

    let next: number | undefined = await fetchPendingNonce();
    let queue = Promise.resolve();

    return async (submit) => {
      const previous = queue;
      let release!: () => void;
      queue = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        if (next === undefined) {
          next = await fetchPendingNonce();
        }
        const nonce = next;
        const hash = await submit(nonce);
        next = nonce + 1;
        return hash;
      } catch (error) {
        try {
          next = await fetchPendingNonce();
        } catch (resyncError) {
          next = undefined;
          this.logger.warn({
            event: "sp_cleanup_nonce_resync_failed",
            message:
              "Failed to re-derive the next nonce after a failed submission; every write until the next " +
              "successful fetch will retry it first rather than trust a stale value",
            error: toStructuredError(resyncError),
          });
        }
        throw error;
      } finally {
        release();
      }
    };
  }

  /** Malformed provider offerings fail an entire SDK page, so isolate and skip only affected data sets. */
  private async getAllPdpDataSets(
    client: ReadOnlyClient,
    address: `0x${string}`,
    signal?: AbortSignal,
  ): Promise<PdpDataSet[]> {
    const dataSets: PdpDataSet[] = [];
    let cursor: bigint | undefined = 0n;
    while (cursor !== undefined) {
      signal?.throwIfAborted();
      const windowStart = cursor;
      try {
        const page = await awaitWithAbort(
          getPdpDataSets(client, { address, cursor, limit: BigInt(READ_BATCH_SIZE) }),
          signal,
        );
        dataSets.push(...page.items);
        cursor = page.nextCursor;
      } catch (error) {
        if (this.isAbortError(error, signal)) throw error;
        if (!ZodValidationError.is(error)) throw error;
        this.logger.warn({
          event: "sp_cleanup_data_set_batch_decode_failed",
          message: "A PDP data set batch failed to decode; bisecting it to isolate the offending data set(s)",
          cursor: windowStart.toString(),
          error: toStructuredError(error),
        });
        dataSets.push(
          ...(await this.getPdpDataSetsBisected(client, address, windowStart, BigInt(READ_BATCH_SIZE), signal)),
        );
        cursor = windowStart + BigInt(READ_BATCH_SIZE);
      }
    }
    return dataSets;
  }

  private async getPdpDataSetsBisected(
    client: ReadOnlyClient,
    address: `0x${string}`,
    cursor: bigint,
    limit: bigint,
    signal?: AbortSignal,
  ): Promise<PdpDataSet[]> {
    signal?.throwIfAborted();
    try {
      const page = await awaitWithAbort(getPdpDataSets(client, { address, cursor, limit }), signal);
      return page.items;
    } catch (error) {
      if (this.isAbortError(error, signal)) throw error;
      if (!ZodValidationError.is(error)) throw error;
      if (limit === 1n) {
        this.logger.warn({
          event: "sp_cleanup_data_set_skipped",
          message: "Skipped a PDP data set whose provider offering failed to decode",
          cursor: cursor.toString(),
          error: toStructuredError(error),
        });
        return [];
      }
      // Sequential, not Promise.all: a genuine RPC/contract-read failure in one half must stop
      // the walk immediately rather than let the other half keep firing concurrent requests.
      const firstHalf = limit / 2n;
      const first = await this.getPdpDataSetsBisected(client, address, cursor, firstHalf, signal);
      const second = await this.getPdpDataSetsBisected(client, address, cursor + firstHalf, limit - firstHalf, signal);
      return [...first, ...second];
    }
  }

  /**
   * Job A: `sp_data_set_pruning`.
   *
   * For each blocked SP, terminates every active (`pdpEndEpoch === 0n`) data set
   * belonging to dealbot's wallet via the provider-relay path (target: 0, no
   * buffer — any leftover active data set for a blocked SP is unwanted).
   *
   * For every other (non-blocked) SP — trickle-tier AND full-rate alike — keeps
   * one live data set for each provisioning slot that tier requires
   * (`trickleTierRates.minNumDataSetsForChecks` or
   * `networkCfg.minNumDataSetsForChecks`) and terminates the surplus once it
   * exceeds `excessDataSetBuffer`. This is a safety net independent of *why* a
   * provider over-accumulated (e.g. a data-set-reuse bug in
   * `provisionNextMissingDataSet`) — it caps the damage without needing that
   * root cause fixed first. The buffer absorbs routine create/replace churn
   * (`provisionNextMissingDataSet` creates at most one data set per tick) so
   * pruning doesn't fight normal slot replacement.
   *
   * Providers are processed concurrently. Relay failures are logged and left for
   * `abandoned_data_set_sweep`.
   */
  async runDataSetPruning(network: Network, signal?: AbortSignal): Promise<void> {
    const networkCfg = this.getNetworkConfig(network);
    const synapse = await this.getSynapse(network);
    const relayClient = (synapse.sessionClient ?? synapse.client) as SynapseViemClient;

    // Single wallet-wide fetch, grouped locally by provider — the listing covers the whole
    // wallet either way, so fetching once per SP would re-read it N times over.
    const allDataSets = await this.getAllPdpDataSets(relayClient, networkCfg.walletAddress as `0x${string}`, signal);
    const activeByProvider = new Map<string, PdpDataSet[]>();
    for (const dataSet of allDataSets) {
      if (dataSet.pdpEndEpoch !== 0n) continue;
      const key = dataSet.serviceProvider.toLowerCase();
      const forProvider = activeByProvider.get(key);
      if (forProvider) {
        forProvider.push(dataSet);
      } else {
        activeByProvider.set(key, [dataSet]);
      }
    }

    // The registry rows are consulted only for `isApproved`, which is FWSS-level approval and
    // has no on-chain equivalent on the provider record. Everything else pruning needs —
    // address, id, name, relay service URL — rides along on the data set itself, so a provider
    // missing from the registry (deregistered, or filtered out of registry sync) is still
    // pruned instead of being silently skipped.
    const approvedByAddress = new Map(
      (await this.storageProviderRepository.findAllByNetwork(network)).map((provider) => [
        provider.serviceProvider.toLowerCase(),
        provider.isApproved,
      ]),
    );
    const baseDataSetMetadata = getBaseDataSetMetadata(networkCfg);
    const lifecycleGraceMs = Math.max(60000, networkCfg.dataSetLifecycleCheckJobTimeoutSeconds * 1000);
    const buffer = networkCfg.excessDataSetBuffer;

    // Prune every provider dealbot holds data sets with, even if it is no longer registry-active.
    // Relay calls use each provider's account, not dealbot's shared transaction nonce.
    await mapWithConcurrency(
      [...activeByProvider.entries()],
      PROVIDER_CONCURRENCY,
      async ([address, activeDataSets]) => {
        signal?.throwIfAborted();
        const provider = activeDataSets[0].provider;
        const blocked = isSpBlocked(networkCfg, provider.serviceProvider, provider.id);
        // An unregistered provider defaults to unapproved, i.e. the trickle target: dealbot runs
        // no checks against it, so it needs no reserved slots.
        const isApproved = approvedByAddress.get(address) ?? false;
        const isFullRate = !blocked && isFullRateTier(networkCfg, provider.serviceProvider, isApproved, provider.id);

        // A blocked SP keeps nothing; everyone else keeps one live set per slot its tier requires.
        let targetCount: number = trickleTierRates.minNumDataSetsForChecks;
        let reason: TerminationReason = "trickle";
        if (blocked) {
          targetCount = 0;
          reason = "blocked";
        } else if (isFullRate) {
          targetCount = networkCfg.minNumDataSetsForChecks;
          reason = "full_rate";
        }

        await this.terminateExcessDataSets(
          relayClient,
          network,
          provider,
          activeDataSets,
          baseDataSetMetadata,
          targetCount,
          blocked ? 0 : buffer,
          lifecycleGraceMs,
          reason,
          signal,
        );
      },
    );
  }

  /**
   * True when a Multicall3 item failed because the whole `aggregate3` call ran out of gas,
   * rather than because that particular call reverted.
   */
  private static isOutOfGasFailure(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? "");
    return /SysErrOutOfGas|out of gas/i.test(message);
  }

  /**
   * Runs one view call per item through Multicall3, `READ_BATCH_SIZE` at a time.
   *
   * The sweep reads one value per data set (last proven epoch, or rail state). Issued one
   * round-trip at a time that is the sweep's dominant cost — measured on calibration,
   * 6,147 sequential reads take ~36 minutes against a 20-minute budget, versus ~100s batched.
   *
   * `allowFailure` is mandatory here because several of these reads revert *by design* (a
   * finalized rail, a data set that no longer exists), and one such revert would otherwise
   * fail the whole batch. The hazard is that viem reports gas exhaustion identically: every
   * item comes back `status: "failure"`, indistinguishable from "they all legitimately
   * reverted". Reading that as "nothing to do" would make the sweep silently skip every data
   * set, every run, with no error in the logs. So a batch whose failures carry the
   * out-of-gas signature is split in half and retried rather than believed.
   */
  private async readInBatches<T>(
    client: ReadOnlyClient,
    items: T[],
    toCall: (item: T) => Parameters<typeof readContract>[1],
    signal?: AbortSignal,
    batchSize: number = READ_BATCH_SIZE,
  ): Promise<{ item: T; value?: unknown; reverted: boolean }[]> {
    const results: { item: T; value?: unknown; reverted: boolean }[] = [];

    for (let start = 0; start < items.length; start += batchSize) {
      signal?.throwIfAborted();
      const slice = items.slice(start, start + batchSize);
      const batch = await awaitWithAbort(
        multicall(client, {
          contracts: slice.map((item) => toCall(item) as never),
          allowFailure: true,
        }),
        signal,
      );

      const outOfGas = batch.some(
        (entry) => entry.status === "failure" && SpCleanupService.isOutOfGasFailure(entry.error),
      );
      if (outOfGas) {
        if (slice.length === 1) {
          // A single call cannot be split further; surface it rather than recording a revert.
          throw new Error(`Multicall read ran out of gas for a single item (batch size ${batchSize})`);
        }
        const half = Math.ceil(slice.length / 2);
        this.logger.warn({
          event: "sp_cleanup_multicall_out_of_gas",
          message: "Multicall batch exhausted node gas; retrying with a smaller batch",
          batchSize: slice.length,
          retryBatchSize: half,
        });
        results.push(...(await this.readInBatches(client, slice, toCall, signal, half)));
        continue;
      }

      for (const [index, entry] of batch.entries()) {
        results.push(
          entry.status === "success"
            ? { item: slice[index], value: entry.result, reverted: false }
            : { item: slice[index], reverted: true },
        );
      }
    }

    return results;
  }

  /**
   * True while a `data_set_lifecycle_check` job could still be using this data set. Its
   * `LIFECYCLE_CHECK_METADATA_KEY` tag is the creating job's `Date.now()`, so age separates
   * a check running right now from one whose job was aborted long ago and leaked the set.
   * Pruning holds no `SP_WORK_QUEUE` lock, so this is what keeps it off a live check.
   */
  private static isLifecycleCheckSetInFlight(dataSet: PdpDataSet, graceMs: number, nowMs: number): boolean {
    const tag = dataSet.metadata[LIFECYCLE_CHECK_METADATA_KEY];
    if (tag === undefined) return false;
    const createdAtMs = Number(tag);
    if (!Number.isFinite(createdAtMs)) return false;
    return nowMs - createdAtMs < graceMs;
  }

  /**
   * Terminates a provider's surplus data sets one at a time via the provider-relay path
   * (mirrors `terminateServiceSync` in data-set-lifecycle.service.ts — the only path
   * dealbot's session key can use for a cooperative SP; see #546 for why the direct 1-arg
   * path is unusable).
   *
   * Survivors are chosen by *provisioning slot* (the baseline set plus
   * `dealbotDS: 1..targetCount-1`, per `provisionNextMissingDataSet`), never by age: the
   * newest `targetCount` sets can all belong to one slot, so age-based retention terminates
   * other slots' only copies and `data_set_creation` re-provisions them, forever. Everything
   * outside the surviving slots is surplus, and `buffer` gates the surplus count.
   */
  private async terminateExcessDataSets(
    relayClient: SynapseViemClient,
    network: Network,
    provider: PdpDataSet["provider"],
    activeDataSets: PdpDataSet[],
    baseDataSetMetadata: Record<string, string>,
    targetCount: number,
    buffer: number,
    lifecycleGraceMs: number,
    reason: TerminationReason,
    signal?: AbortSignal,
  ): Promise<void> {
    const spAddress = provider.serviceProvider;

    // `findMatchingDataSets` is the SDK's own matcher and ordering — exact metadata equality,
    // then piece-bearing sets ahead of empty ones, then lowest id. Its first entry is therefore
    // the set `createContext` resolves this slot to. Using it rather than reimplementing the
    // rule is deliberate: pruning terminates whatever it fails to claim, so any drift from the
    // SDK's choice would delete the set deal jobs are writing to.
    const survivors = new Set<bigint>();
    for (let slot = 0; slot < targetCount; slot++) {
      const survivor = findMatchingDataSets(activeDataSets, storedSlotMetadata(baseDataSetMetadata, slot))[0];
      if (survivor) {
        survivors.add(survivor.dataSetId);
      }
    }

    // Reconstructing a slot's metadata means reproducing what the SDK stores, `source` and all.
    // If that ever drifts again, every data set looks unslotted and therefore surplus, and this
    // method would terminate the provider's entire holding. Claiming nothing at all while sets
    // exist is not a state normal operation reaches, so treat it as a bug and do nothing.
    if (targetCount > 0 && survivors.size === 0 && activeDataSets.length > 0) {
      this.logger.error({
        network,
        reason,
        providerAddress: spAddress,
        event: "sp_cleanup_no_slot_matched",
        message:
          "No active data set matched any required provisioning slot; skipping this provider rather than treating every set as surplus",
        activeCount: activeDataSets.length,
        expectedSlotMetadata: storedSlotMetadata(baseDataSetMetadata, 0),
        observedMetadata: activeDataSets.slice(0, 3).map((dataSet) => dataSet.metadata),
      });
      return;
    }

    const nowMs = Date.now();
    const toTerminate = activeDataSets.filter(
      (dataSet) =>
        !survivors.has(dataSet.dataSetId) &&
        !SpCleanupService.isLifecycleCheckSetInFlight(dataSet, lifecycleGraceMs, nowMs),
    );

    if (toTerminate.length <= buffer) {
      return;
    }

    this.logger.log({
      network,
      reason,
      providerAddress: spAddress,
      providerId: provider.id.toString(),
      providerName: provider.name,
      event: "sp_cleanup_pruning_plan",
      message: "Pruning surplus data sets; one set is retained per required provisioning slot",
      activeCount: activeDataSets.length,
      targetCount,
      retainedDataSetIds: [...survivors].map(String),
      surplusDataSetIds: toTerminate.map((dataSet) => dataSet.dataSetId.toString()),
    });

    // Bound relay traffic to this provider.
    await mapWithConcurrency(toTerminate, RELAY_CONCURRENCY, async (dataSet) => {
      // Checked per data set (not just per provider) — a provider with many excess data sets
      // must not keep relaying past the deadline just because it's mid-batch.
      signal?.throwIfAborted();
      const logContext = {
        network,
        reason,
        providerAddress: spAddress,
        providerId: provider.id.toString(),
        providerName: provider.name,
        dataSetId: dataSet.dataSetId.toString(),
      };
      try {
        // The plan came from a snapshot taken before this loop, under no per-provider lock —
        // another job may have terminated this set since.
        const current = await awaitWithAbort(getDataSet(relayClient, { dataSetId: dataSet.dataSetId }), signal);
        if (current == null || current.pdpEndEpoch !== 0n) {
          this.logger.log({
            ...logContext,
            event: "sp_cleanup_data_set_terminate_skipped",
            message: "Data set is no longer active; skipping termination",
          });
          return;
        }

        await awaitWithAbort(
          terminateServiceSync(relayClient, {
            dataSetId: dataSet.dataSetId,
            serviceURL: provider.pdp.serviceURL,
            onHash: (hash) => {
              this.logger.log({
                ...logContext,
                event: "sp_cleanup_data_set_terminating",
                message: "Data set pruning terminate transaction submitted",
                txHash: hash,
              });
            },
          }),
          signal,
        );
        this.recordAttempt(network, reason, "success");
        this.logger.log({
          ...logContext,
          event: "sp_cleanup_data_set_terminated",
          message: "Data set terminated by sp_data_set_pruning",
        });
      } catch (error) {
        // Relay failures are expected; only the job's abort should stop the batch.
        if (this.isAbortError(error, signal)) throw error;
        this.recordAttempt(network, reason, "failure");
        this.logger.warn({
          ...logContext,
          event: "sp_cleanup_data_set_terminate_failed",
          message: "Provider-relay termination attempt failed; will retry on next run",
          error: toStructuredError(error),
        });
      }
    });
  }

  /**
   * Job B: `abandoned_data_set_sweep`.
   *
   * Stateless, network-wide (not per-SP, not conditioned on blocklist status).
   * Scans every data set dealbot's wallet holds:
   *
   *   Branch 1 (abandonment): `pdpEndEpoch === 0n` and outside PDPVerifier's
   *   activity window -> `deleteDataSet` is fully permissionless past that
   *   window, so it's called directly with the session key's own wallet
   *   (no signature/relay, but real gas from the session key's own balance).
   *
   *   Branch 2 (stuck settlement): `pdpEndEpoch > 0n` and the lockup has fully
   *   elapsed (`currentBlock > pdpEndEpoch`, strict) but the rail is still
   *   unsettled -> `settleRail` (unlike `settleTerminatedRailWithoutValidation`)
   *   has no caller restriction at all, so the session key attempts it directly
   *   first; this resolves the common case (SP just never bothered to settle
   *   themselves) with no human involved. Only a genuine settlement failure
   *   (the validator is actually stuck, e.g. an unresolvable open proving
   *   period) falls through to needing the Safe's own signature, logged fresh
   *   every run for a human operator.
   *
   * Direct writes run concurrently, with submission serialized by `createNonceAllocator`.
   */
  async runAbandonedDataSetSweep(network: Network, signal?: AbortSignal): Promise<void> {
    const synapse = await this.getSynapse(network);
    const readClient = synapse.client as SynapseViemClient;
    const writeClient = (synapse.sessionClient ?? synapse.client) as SynapseViemClient;
    const chain = asChain(readClient.chain);
    const pdpVerifier = chain.contracts.pdp;
    const submitWithNonce = await this.createNonceAllocator(writeClient, signal);

    const networkCfg = this.getNetworkConfig(network);
    const allDataSets = await this.getAllPdpDataSets(readClient, networkCfg.walletAddress as `0x${string}`, signal);
    const currentBlock = await awaitWithAbort(getBlockNumber(readClient), signal);

    const stuckItems: StuckRailItem[] = [];
    const abi = pdpVerifier.abi as Parameters<typeof readContract>[1]["abi"];

    // Batch view calls so large wallets do not spend the whole job window reading serially.
    const abandonmentCandidates = allDataSets.filter((dataSet) => dataSet.pdpEndEpoch === 0n);
    const settlementCandidates = allDataSets.filter(
      (dataSet) => dataSet.pdpEndEpoch > 0n && currentBlock > dataSet.pdpEndEpoch,
    );

    // Branch 1: only data sets outside PDPVerifier's activity window can be deleted.
    const lastProvenEpochs = await this.readInBatches(
      readClient,
      abandonmentCandidates,
      (dataSet) => ({
        address: pdpVerifier.address,
        abi,
        functionName: "getDataSetLastProvenEpoch",
        args: [dataSet.dataSetId],
      }),
      signal,
    );

    const abandoned: { dataSet: PdpDataSet; lastProvenEpoch: bigint }[] = [];
    for (const { item: dataSet, value, reverted } of lastProvenEpochs) {
      if (reverted) {
        // A single data set's read must never abort the sweep — every data set after it
        // (including branch 2) would silently go unchecked for this run.
        this.recordAttempt(network, "abandonment", "failure");
        this.logger.warn({
          network,
          reason: "abandonment",
          providerAddress: dataSet.serviceProvider,
          dataSetId: dataSet.dataSetId.toString(),
          event: "sp_cleanup_last_proven_epoch_read_failed",
          message: "Failed to read getDataSetLastProvenEpoch; skipping this data set for this sweep",
        });
        continue;
      }
      const lastProvenEpoch = value as bigint;
      if (currentBlock <= lastProvenEpoch + PDP_INACTIVITY_WINDOW_BLOCKS) continue;
      abandoned.push({ dataSet, lastProvenEpoch });
    }

    await mapWithConcurrency(abandoned, WRITE_CONCURRENCY, async ({ dataSet, lastProvenEpoch }) => {
      signal?.throwIfAborted();
      await this.handleAbandonmentCandidate(
        writeClient,
        pdpVerifier,
        network,
        dataSet,
        lastProvenEpoch,
        currentBlock,
        submitWithNonce,
        signal,
      );
    });

    // Branch 2: a reverting getRail means the rail is already finalized — nothing to do.
    const rails = await this.readInBatches(
      readClient,
      settlementCandidates,
      (dataSet) => ({
        address: chain.contracts.filecoinPay.address,
        abi: chain.contracts.filecoinPay.abi as Parameters<typeof readContract>[1]["abi"],
        functionName: "getRail",
        args: [dataSet.pdpRailId],
      }),
      signal,
    );

    const settleable = rails.filter(({ reverted }) => !reverted).map(({ item }) => item);
    await mapWithConcurrency(settleable, WRITE_CONCURRENCY, async (dataSet) => {
      signal?.throwIfAborted();
      const stuck = await this.settleOrFlagStuck(writeClient, chain, network, dataSet, submitWithNonce, signal);
      if (stuck) {
        stuckItems.push(stuck);
      }
    });

    this.spTerminationStuckGauge.set({ network }, stuckItems.length);

    if (stuckItems.length > 0) {
      this.logStuckTerminations(network, chain, stuckItems);
    }
  }

  /** The caller has already established that this data set is outside the activity window. */
  private async handleAbandonmentCandidate(
    writeClient: SynapseViemClient,
    pdpVerifier: { address: `0x${string}`; abi: unknown },
    network: Network,
    dataSet: { dataSetId: bigint; serviceProvider: string },
    lastProvenEpoch: bigint,
    currentBlock: bigint,
    submitWithNonce: SubmitWithNonce,
    signal?: AbortSignal,
  ): Promise<void> {
    const abi = pdpVerifier.abi as Parameters<typeof readContract>[1]["abi"];
    const logContext = {
      network,
      reason: "abandonment" as const,
      providerAddress: dataSet.serviceProvider,
      dataSetId: dataSet.dataSetId.toString(),
      lastProvenEpoch: lastProvenEpoch.toString(),
      currentBlock: currentBlock.toString(),
    };

    try {
      const { request } = await awaitWithAbort(
        simulateContract(writeClient, {
          address: pdpVerifier.address,
          abi,
          functionName: "deleteDataSet",
          args: [dataSet.dataSetId, "0x"],
        }),
        signal,
      );
      // Once submitted, track the transaction to completion even if the job deadline passes.
      const hash = await submitWithNonce((nonce) => writeContract(writeClient, { ...request, nonce }));
      const receipt = await waitForTransactionReceipt(writeClient, { hash });
      if (receipt.status !== "success") {
        throw new Error(`deleteDataSet transaction reverted on-chain (hash: ${hash})`);
      }
      this.recordAttempt(network, "abandonment", "success");
      this.logger.log({
        ...logContext,
        event: "sp_cleanup_data_set_abandoned_deleted",
        message: "Abandoned data set deleted directly via PDPVerifier.deleteDataSet (no signature required)",
        txHash: hash,
      });
    } catch (error) {
      // Only a pre-submission abort is a job timeout.
      if (this.isAbortError(error, signal)) throw error;
      this.recordAttempt(network, "abandonment", "failure");
      this.logger.warn({
        ...logContext,
        event: "sp_cleanup_data_set_abandoned_delete_failed",
        message: "Direct deleteDataSet call failed; will retry on next sweep",
        error: toStructuredError(error),
      });
      return;
    }

    // Deliberately outside the try/catch above: deleteDataSet already succeeded and was recorded,
    // so a timeout abort here must propagate to the job handler as-is, not get relabeled as a
    // deleteDataSet failure (finishCleanupPieces handles its own errors internally already).
    await this.finishCleanupPieces(writeClient, pdpVerifier, abi, dataSet, logContext, submitWithNonce, signal);
  }

  /** Finishes remaining pieces after deletion so the provider's cleanup deposit is released. */
  private async finishCleanupPieces(
    writeClient: SynapseViemClient,
    pdpVerifier: { address: `0x${string}`; abi: unknown },
    abi: Parameters<typeof readContract>[1]["abi"],
    dataSet: { dataSetId: bigint; serviceProvider: string },
    logContext: Record<string, unknown>,
    submitWithNonce: SubmitWithNonce,
    signal?: AbortSignal,
  ): Promise<void> {
    const CLEANUP_PIECES_BATCH_SIZE = 100n;
    // Guards against a bad on-chain `done` flag.
    const MAX_ITERATIONS = 200;
    // Deleted data sets are no longer discoverable, so cleanup must retry here.
    const MAX_CONSECUTIVE_FAILURES = 5;

    let consecutiveFailures = 0;

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      signal?.throwIfAborted();
      try {
        const { request, result: done } = await awaitWithAbort(
          simulateContract(writeClient, {
            address: pdpVerifier.address,
            abi,
            functionName: "cleanupPieces",
            args: [dataSet.dataSetId, CLEANUP_PIECES_BATCH_SIZE],
          }),
          signal,
        );
        // Once submitted, track the batch to completion even if the deadline passes.
        const hash = await submitWithNonce((nonce) => writeContract(writeClient, { ...request, nonce }));
        const receipt = await waitForTransactionReceipt(writeClient, { hash });
        if (receipt.status !== "success") {
          throw new Error(`cleanupPieces transaction reverted on-chain (hash: ${hash})`);
        }
        consecutiveFailures = 0;
        this.logger.log({
          ...logContext,
          event: "sp_cleanup_pieces_cleaned",
          message: "cleanupPieces batch submitted",
          txHash: hash,
          iteration,
          done,
        });
        if (done) {
          return;
        }
      } catch (error) {
        if (this.extractContractRevert(error)?.data?.errorName === "DataSetNotInCleanupMode") {
          // Zero-piece data sets never enter cleanup mode.
          this.logger.debug({
            ...logContext,
            event: "sp_cleanup_pieces_cleanup_not_needed",
            message: "cleanupPieces not in cleanup mode; deleteDataSet already finalized this data set",
          });
          return;
        }

        // Only pre-submission work is abortible.
        if (this.isAbortError(error, signal)) throw error;
        consecutiveFailures++;
        this.logger.warn({
          ...logContext,
          event: "sp_cleanup_pieces_batch_failed",
          message: "cleanupPieces batch failed; retrying within this sweep",
          iteration,
          consecutiveFailures,
          error: toStructuredError(error),
        });

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          this.logger.warn({
            ...logContext,
            event: "sp_cleanup_pieces_cleanup_incomplete",
            message: `cleanupPieces failed ${MAX_CONSECUTIVE_FAILURES} times in a row for this data set; giving up — it is no longer discoverable via listDataSets, so its cleanup deposit and remaining pieces may be permanently stranded`,
          });
          return;
        }
      }
    }

    this.logger.warn({
      ...logContext,
      event: "sp_cleanup_pieces_cleanup_incomplete",
      message: `cleanupPieces did not finish after ${MAX_ITERATIONS} batches; will need manual follow-up`,
    });
  }

  /** Attempts permissionless settlement; only a contract revert requires the Safe-only fallback. */
  private async settleOrFlagStuck(
    writeClient: SynapseViemClient,
    chain: ReturnType<typeof asChain>,
    network: Network,
    dataSet: { dataSetId: bigint; serviceProvider: string; pdpRailId: bigint; pdpEndEpoch: bigint },
    submitWithNonce: SubmitWithNonce,
    signal?: AbortSignal,
  ): Promise<StuckRailItem | null> {
    const logContext = {
      network,
      reason: "settlement" as const,
      providerAddress: dataSet.serviceProvider,
      dataSetId: dataSet.dataSetId.toString(),
      railId: dataSet.pdpRailId.toString(),
    };

    // Even fully paid rails need settleRail to finalize and release their lockup.
    // Build the call explicitly so the shared nonce allocator controls submission.
    try {
      const { request } = await awaitWithAbort(
        simulateContract(
          writeClient,
          settleRailCall({ chain, railId: dataSet.pdpRailId, untilEpoch: dataSet.pdpEndEpoch }),
        ),
        signal,
      );
      // Once submitted, track settlement to completion even if the deadline passes.
      const hash = await submitWithNonce((nonce) => writeContract(writeClient, { ...request, nonce }));
      const receipt = await waitForTransactionReceipt(writeClient, { hash });
      if (receipt.status !== "success") {
        // A mined revert needs the same Safe fallback as a simulation revert.
        this.recordAttempt(network, "settlement", "failure");
        this.logger.warn({
          ...logContext,
          event: "sp_cleanup_settle_rail_stuck",
          message: "settleRail transaction reverted on-chain; validator appears stuck — needs a human Safe batch",
          txHash: hash,
        });
        return { dataSetId: dataSet.dataSetId, spAddress: dataSet.serviceProvider, railId: dataSet.pdpRailId };
      }
      this.recordAttempt(network, "settlement", "success");
      this.logger.log({
        ...logContext,
        event: "sp_cleanup_rail_settled",
        message: "Rail settled (or finalized) via permissionless settleRail",
        txHash: hash,
      });
      return null;
    } catch (error) {
      // Only a pre-submission abort is a job timeout.
      if (this.isAbortError(error, signal)) throw error;
      this.recordAttempt(network, "settlement", "failure");
      if (!this.isContractRevert(error)) {
        this.logger.warn({
          ...logContext,
          event: "sp_cleanup_settle_rail_read_failed",
          message: "settleRail attempt failed for a non-revert reason (RPC/transport); will retry next sweep",
          error: toStructuredError(error),
        });
        return null;
      }
      // Contract reverts need a human with the Safe.
      this.logger.warn({
        ...logContext,
        event: "sp_cleanup_settle_rail_stuck",
        message: "settleRail reverted; validator appears stuck — needs a human Safe batch",
        error: toStructuredError(error),
      });
      return { dataSetId: dataSet.dataSetId, spAddress: dataSet.serviceProvider, railId: dataSet.pdpRailId };
    }
  }

  private extractContractRevert(error: unknown): ContractFunctionRevertedError | null {
    if (!(error instanceof Error) || !("walk" in error) || typeof (error as { walk?: unknown }).walk !== "function") {
      return null;
    }
    return (
      ((error as { walk: (fn: (e: unknown) => boolean) => unknown }).walk(
        (e) => e instanceof ContractFunctionRevertedError,
      ) as ContractFunctionRevertedError | null) ?? null
    );
  }

  private isContractRevert(error: unknown): boolean {
    return this.extractContractRevert(error) != null;
  }

  /** Distinguishes an interrupted step from an unrelated failure after the deadline passed. */
  private isAbortError(error: unknown, signal?: AbortSignal): boolean {
    return signal !== undefined && error === signal.reason;
  }

  /** Logs a Safe Transaction Builder batch for rails requiring operator settlement. */
  private logStuckTerminations(network: Network, chain: ReturnType<typeof asChain>, stuckItems: StuckRailItem[]): void {
    const filecoinPayAddress = chain.contracts.filecoinPay.address;
    const walletAddress = this.getNetworkConfig(network).walletAddress;

    const transactions = stuckItems.map((item) => {
      const call = settleTerminatedRailWithoutValidationCall({ chain, railId: item.railId });
      const data = encodeFunctionData(call);
      return {
        to: filecoinPayAddress,
        value: "0",
        data,
        contractMethod: null,
        contractInputsValues: null,
      };
    });

    const batch = withSafeBatchChecksum({
      version: "1.0",
      chainId: String(chain.id),
      createdAt: Date.now(),
      meta: {
        name: "Stuck rail settlements",
        description: "settleTerminatedRailWithoutValidation for data sets whose termination lockup has fully elapsed",
        txBuilderVersion: "1.16.5",
        createdFromSafeAddress: walletAddress,
        createdFromOwnerAddress: "",
      },
      transactions,
    });

    this.logger.warn({
      event: "stuck_terminations_detected",
      message: "Terminated data sets found whose rail settlement is stuck past endEpoch; needs a human Safe batch",
      network,
      count: stuckItems.length,
      items: stuckItems.map((item) => ({
        dataSetId: item.dataSetId.toString(),
        spAddress: item.spAddress,
        railId: item.railId.toString(),
      })),
      batch,
    });
  }
}
