import { asChain } from "@filoz/synapse-core/chains";
import { getRail, settleRailSync, settleTerminatedRailWithoutValidationCall } from "@filoz/synapse-core/pay";
import { toReadClient } from "@filoz/synapse-core/utils";
import type { Synapse } from "@filoz/synapse-sdk";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import { listDataSets } from "filecoin-pin/core/data-set";
import type { Counter, Gauge } from "prom-client";
import type { Chain, Client, Transport } from "viem";
import { ContractFunctionRevertedError, encodeFunctionData, keccak256, stringToBytes } from "viem";
import { getBlockNumber, readContract, simulateContract, waitForTransactionReceipt, writeContract } from "viem/actions";
import { toStructuredError } from "../common/logging.js";
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
import type { PDPProviderEx } from "../wallet-sdk/wallet-sdk.types.js";

/**
 * `PDPVerifier.INACTIVITY_WINDOW` — the number of blocks after the last proven
 * epoch during which `deleteDataSet` still requires `msg.sender == sp`. Past
 * this window `deleteDataSet` is fully permissionless. ~30 days at ~1 block/30s.
 */
const PDP_INACTIVITY_WINDOW_BLOCKS = 86400n;

type TerminationReason = "blocked" | "trickle" | "full_rate" | "abandonment" | "settlement";
type TerminationOutcome = "success" | "failure";

/** A read-only viem client (no signing account required) — sufficient for `readContract`/`getBlockNumber`/`getRail`. */
type ReadOnlyClient = Client<Transport, Chain>;

interface StuckRailItem {
  dataSetId: bigint;
  spAddress: string;
  railId: bigint;
}

type DataSetSummary = Awaited<ReturnType<typeof listDataSets>>[number];

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
    return this.walletSdkService.tryGetSynapse(network) ?? (await this.createSynapseInstance(network));
  }

  private recordAttempt(network: Network, reason: TerminationReason, outcome: TerminationOutcome): void {
    this.spTerminationAttemptsCounter.inc({ network, outcome, reason });
  }

  /**
   * Job A: `sp_dataset_pruning`.
   *
   * For each blocked SP, terminates every active (`pdpEndEpoch === 0n`) data set
   * belonging to dealbot's wallet via the provider-relay path (target: 0, no
   * buffer — any leftover active data set for a blocked SP is unwanted).
   *
   * For every other (non-blocked) SP — trickle-tier AND full-rate alike —
   * prunes down to that tier's target (`trickleTierRates.minNumDataSetsForChecks`
   * or `networkCfg.minNumDataSetsForChecks`) whenever the active count exceeds
   * target + `excessDatasetBuffer`. This is a safety net independent of *why*
   * a provider over-accumulated (e.g. a data-set-reuse bug in
   * `provisionNextMissingDataSet`) — it caps the damage without needing that
   * root cause fixed first. The buffer absorbs routine create/replace churn
   * (`provisionNextMissingDataSet` creates at most one data set per tick) so
   * pruning doesn't fight normal slot replacement.
   *
   * Runs strictly serially; a per-attempt failure is caught, logged, and
   * counted — never aborts the batch, since a dead/unreachable SP is expected
   * here and is left for `abandoned_dataset_sweep` to clean up permissionlessly.
   */
  async runDatasetPruning(network: Network, signal?: AbortSignal): Promise<void> {
    const networkCfg = this.getNetworkConfig(network);
    const synapse = await this.getSynapse(network);
    const relayClient = (this.walletSdkService.getSynapseClient(network) ??
      synapse.sessionClient ??
      synapse.client) as SynapseViemClient;

    // Single wallet-wide fetch, grouped locally by provider — listDataSets always fetches every
    // data set for the wallet and filters client-side, so calling it once per SP here would
    // re-fetch the whole wallet N+M times as the blocklist/trickle-tier list grows.
    const allDataSets = await listDataSets(synapse, {});
    const activeByProvider = new Map<string, DataSetSummary[]>();
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

    const allProviders = await this.storageProviderRepository.findAllByNetwork(network);
    const blockedProviders = allProviders.filter((provider) =>
      isSpBlocked(networkCfg, provider.serviceProvider, provider.id),
    );

    for (const provider of blockedProviders) {
      signal?.throwIfAborted();
      const activeDataSets = activeByProvider.get(provider.serviceProvider.toLowerCase()) ?? [];
      await this.terminateExcessDataSets(relayClient, network, provider, activeDataSets, 0, 0, "blocked");
    }

    // Deliberately not scoped to findActiveAddresses (registry-active, optionally approved-only)
    // — pruning is a safety net against excess data sets regardless of a provider's current
    // check-eligibility, so it must cover every non-blocked provider dealbot holds data sets with.
    const buffer = networkCfg.excessDatasetBuffer;
    const nonBlockedProviders = allProviders.filter(
      (provider) => !isSpBlocked(networkCfg, provider.serviceProvider, provider.id),
    );

    for (const provider of nonBlockedProviders) {
      signal?.throwIfAborted();
      const activeDataSets = activeByProvider.get(provider.serviceProvider.toLowerCase()) ?? [];
      const isFullRate = isFullRateTier(networkCfg, provider.serviceProvider, provider.isApproved, provider.id);
      const target = isFullRate ? networkCfg.minNumDataSetsForChecks : trickleTierRates.minNumDataSetsForChecks;
      await this.terminateExcessDataSets(
        relayClient,
        network,
        provider,
        activeDataSets,
        target,
        buffer,
        isFullRate ? "full_rate" : "trickle",
      );
    }
  }

  /**
   * Terminates the oldest of `activeDataSets` down to `targetCount`, one at a time via the
   * provider-relay path (mirrors `terminateServiceSync` in data-set-lifecycle.service.ts — the
   * only path dealbot's session key can use for a cooperative SP; see #546 for why the direct
   * 1-arg path is unusable). Only triggers once the count exceeds `targetCount + buffer`, but
   * once triggered prunes all the way back to `targetCount` (the buffer is a trigger threshold,
   * not a permanent floor).
   */
  private async terminateExcessDataSets(
    relayClient: SynapseViemClient,
    network: Network,
    provider: PDPProviderEx,
    activeDataSets: DataSetSummary[],
    targetCount: number,
    buffer: number,
    reason: TerminationReason,
  ): Promise<void> {
    const spAddress = provider.serviceProvider;

    if (activeDataSets.length <= targetCount + buffer) {
      return;
    }

    // Oldest first (lower dataSetId ~= created earlier); keep the newest `targetCount`.
    const sorted = [...activeDataSets].sort((a, b) => {
      if (a.dataSetId === b.dataSetId) return 0;
      return a.dataSetId < b.dataSetId ? -1 : 1;
    });
    const toTerminate = sorted.slice(0, sorted.length - targetCount);

    for (const dataSet of toTerminate) {
      const logContext = {
        network,
        reason,
        providerAddress: spAddress,
        providerId: provider.id.toString(),
        providerName: provider.name,
        dataSetId: dataSet.dataSetId.toString(),
      };
      try {
        await terminateServiceSync(relayClient, {
          dataSetId: dataSet.dataSetId,
          serviceURL: provider.pdp.serviceURL,
          onHash: (hash) => {
            this.logger.log({
              ...logContext,
              event: "sp_cleanup_dataset_terminating",
              message: "Blocklist-cleanup terminate transaction submitted",
              txHash: hash,
            });
          },
        });
        this.recordAttempt(network, reason, "success");
        this.logger.log({
          ...logContext,
          event: "sp_cleanup_dataset_terminated",
          message: "Data set terminated by sp_dataset_pruning",
        });
      } catch (error) {
        this.recordAttempt(network, reason, "failure");
        this.logger.warn({
          ...logContext,
          event: "sp_cleanup_dataset_terminate_failed",
          message: "Provider-relay termination attempt failed; will retry on next run",
          error: toStructuredError(error),
        });
        // Continue to the next data set — a single dead SP must not abort the batch.
      }
    }
  }

  /**
   * Job B: `abandoned_dataset_sweep`.
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
   */
  async runAbandonedDatasetSweep(network: Network, signal?: AbortSignal): Promise<void> {
    const synapse = await this.getSynapse(network);
    const readClient: ReadOnlyClient = toReadClient(
      (this.walletSdkService.getSynapseClient(network) ?? synapse.client) as SynapseViemClient,
    );
    const writeClient = (synapse.sessionClient ?? synapse.client) as SynapseViemClient;
    const chain = asChain(readClient.chain);
    const pdpVerifier = chain.contracts.pdp;

    const allDataSets = await listDataSets(synapse, {});
    const currentBlock = await getBlockNumber(readClient);

    const stuckItems: StuckRailItem[] = [];

    for (const dataSet of allDataSets) {
      signal?.throwIfAborted();
      if (dataSet.pdpEndEpoch === 0n) {
        await this.handleAbandonmentCandidate(readClient, writeClient, pdpVerifier, network, dataSet, currentBlock);
        continue;
      }

      if (dataSet.pdpEndEpoch > 0n && currentBlock > dataSet.pdpEndEpoch) {
        const stuck = await this.settleOrFlagStuck(readClient, writeClient, network, dataSet);
        if (stuck) {
          stuckItems.push(stuck);
        }
      }
    }

    this.spTerminationStuckGauge.set({ network }, stuckItems.length);

    if (stuckItems.length > 0) {
      this.logStuckTerminations(network, chain, stuckItems);
    }
  }

  private async handleAbandonmentCandidate(
    readClient: ReadOnlyClient,
    writeClient: SynapseViemClient,
    pdpVerifier: { address: `0x${string}`; abi: unknown },
    network: Network,
    dataSet: { dataSetId: bigint; serviceProvider: string },
    currentBlock: bigint,
  ): Promise<void> {
    const abi = pdpVerifier.abi as Parameters<typeof readContract>[1]["abi"];
    const baseLogContext = {
      network,
      reason: "abandonment" as const,
      providerAddress: dataSet.serviceProvider,
      dataSetId: dataSet.dataSetId.toString(),
    };

    let lastProvenEpoch: bigint;
    try {
      lastProvenEpoch = (await readContract(readClient, {
        address: pdpVerifier.address,
        abi,
        functionName: "getDataSetLastProvenEpoch",
        args: [dataSet.dataSetId],
      })) as bigint;
    } catch (error) {
      // A single data set's read must never abort the sweep loop — every data set after it
      // (including Branch 2's stuck-settlement scan) would silently go unchecked for this run.
      this.recordAttempt(network, "abandonment", "failure");
      this.logger.warn({
        ...baseLogContext,
        event: "sp_cleanup_last_proven_epoch_read_failed",
        message: "Failed to read getDataSetLastProvenEpoch; skipping this data set for this sweep",
        error: toStructuredError(error),
      });
      return;
    }

    const withinActivityWindow = currentBlock <= lastProvenEpoch + PDP_INACTIVITY_WINDOW_BLOCKS;
    if (withinActivityWindow) {
      return;
    }

    const logContext = {
      ...baseLogContext,
      lastProvenEpoch: lastProvenEpoch.toString(),
      currentBlock: currentBlock.toString(),
    };

    try {
      const { request } = await simulateContract(writeClient, {
        address: pdpVerifier.address,
        abi,
        functionName: "deleteDataSet",
        args: [dataSet.dataSetId, "0x"],
      });
      const hash = await writeContract(writeClient, request);
      const receipt = await waitForTransactionReceipt(writeClient, { hash });
      if (receipt.status !== "success") {
        throw new Error(`deleteDataSet transaction reverted on-chain (hash: ${hash})`);
      }
      this.recordAttempt(network, "abandonment", "success");
      this.logger.log({
        ...logContext,
        event: "sp_cleanup_dataset_abandoned_deleted",
        message: "Abandoned data set deleted directly via PDPVerifier.deleteDataSet (no signature required)",
        txHash: hash,
      });

      await this.finishCleanupPieces(writeClient, pdpVerifier, abi, dataSet, logContext);
    } catch (error) {
      this.recordAttempt(network, "abandonment", "failure");
      this.logger.warn({
        ...logContext,
        event: "sp_cleanup_dataset_abandoned_delete_failed",
        message: "Direct deleteDataSet call failed; will retry on next sweep",
        error: toStructuredError(error),
      });
    }
  }

  /**
   * `PDPVerifier.deleteDataSet` only finalizes cleanup (and pays the `cleanupDeposit` FIL bond
   * to msg.sender) immediately when the data set has zero remaining pieces. If pieces remain, it
   * instead enters "cleanup mode" (`nextChallengeEpoch == CLEANUP_MODE_SENTINEL`) and the deposit
   * stays locked until `cleanupPieces` is called — permissionless in this context, same gate as
   * `deleteDataSet` — enough times to clear every piece. Without this follow-up, the rail is torn
   * down (already handled by `dataSetDeleted`'s `abandonRails` call) but dealbot's own
   * originally-posted FIL deposit for this data set is left stranded in the contract forever.
   */
  private async finishCleanupPieces(
    writeClient: SynapseViemClient,
    pdpVerifier: { address: `0x${string}`; abi: unknown },
    abi: Parameters<typeof readContract>[1]["abi"],
    dataSet: { dataSetId: bigint; serviceProvider: string },
    logContext: Record<string, unknown>,
  ): Promise<void> {
    const CLEANUP_PIECES_BATCH_SIZE = 100n;
    // A cap here is a safety net against an infinite loop if `done` is ever wrong on-chain —
    // not a realistic piece count ceiling for a single data set.
    const MAX_ITERATIONS = 200;

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      try {
        const { request, result: done } = await simulateContract(writeClient, {
          address: pdpVerifier.address,
          abi,
          functionName: "cleanupPieces",
          args: [dataSet.dataSetId, CLEANUP_PIECES_BATCH_SIZE],
        });
        const hash = await writeContract(writeClient, request);
        await waitForTransactionReceipt(writeClient, { hash });
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
        // Not in cleanup mode (the data set had zero pieces and deleteDataSet already
        // finalized/paid the deposit directly) is the expected common case here — not a failure.
        this.logger.debug({
          ...logContext,
          event: "sp_cleanup_pieces_cleanup_not_needed_or_failed",
          message: "cleanupPieces call did not proceed; assuming deleteDataSet already finalized this data set",
          error: toStructuredError(error),
        });
        return;
      }
    }

    this.logger.warn({
      ...logContext,
      event: "sp_cleanup_pieces_cleanup_incomplete",
      message: `cleanupPieces did not finish after ${MAX_ITERATIONS} batches; will need manual follow-up`,
    });
  }

  /**
   * `settleTerminatedRailWithoutValidation` is `onlyRailClient` (the Safe's own address) and so
   * unusable by dealbot's session key — but plain `settleRail` has no caller restriction at all
   * (only `validateRailActive`, which just checks the rail hasn't been fully zeroed out yet).
   * Most "SP terminated cooperatively but never called settleRail themselves" cases resolve here
   * automatically, no human involved. Only a genuine validator-stuck settlement (`settleRail`
   * itself reverts, e.g. `NoProgressInSettlement` on an unresolvable open proving period) needs
   * the Safe's escape hatch — that's the only case that gets flagged for a human.
   */
  private async settleOrFlagStuck(
    readClient: ReadOnlyClient,
    writeClient: SynapseViemClient,
    network: Network,
    dataSet: { dataSetId: bigint; serviceProvider: string; pdpRailId: bigint; pdpEndEpoch: bigint },
  ): Promise<StuckRailItem | null> {
    const logContext = {
      network,
      reason: "settlement" as const,
      providerAddress: dataSet.serviceProvider,
      dataSetId: dataSet.dataSetId.toString(),
      railId: dataSet.pdpRailId.toString(),
    };

    let rail: Awaited<ReturnType<typeof getRail>>;
    try {
      rail = await getRail(readClient, { railId: dataSet.pdpRailId });
    } catch (error) {
      if (!this.isContractRevert(error)) {
        this.logger.warn({
          ...logContext,
          event: "sp_cleanup_get_rail_read_failed",
          message:
            "getRail read failed for a non-revert reason (RPC/transport); cannot confirm finalized — excluding from this run's stuck count, will re-check next sweep",
          error: toStructuredError(error),
        });
      }
      // A genuine revert here means the rail is already fully finalized/removed — nothing to do.
      return null;
    }

    if (rail.settledUpTo >= rail.endEpoch) {
      return null;
    }

    try {
      await settleRailSync(writeClient, { railId: dataSet.pdpRailId, untilEpoch: dataSet.pdpEndEpoch });
      this.recordAttempt(network, "settlement", "success");
      this.logger.log({
        ...logContext,
        event: "sp_cleanup_rail_settled",
        message: "Rail settled via permissionless settleRail (the SP never settled it themselves)",
      });
      return null;
    } catch (error) {
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
      // A real revert here (the rail exists and isn't fully settled, per the getRail check above)
      // is the genuine validator-stuck case — needs a human with the Safe.
      this.logger.warn({
        ...logContext,
        event: "sp_cleanup_settle_rail_stuck",
        message: "settleRail reverted; validator appears stuck — needs a human Safe batch",
        error: toStructuredError(error),
      });
      return { dataSetId: dataSet.dataSetId, spAddress: dataSet.serviceProvider, railId: dataSet.pdpRailId };
    }
  }

  private isContractRevert(error: unknown): boolean {
    return (
      error instanceof Error &&
      "walk" in error &&
      typeof (error as { walk?: unknown }).walk === "function" &&
      (error as { walk: (fn: (e: unknown) => boolean) => unknown }).walk(
        (e) => e instanceof ContractFunctionRevertedError,
      ) != null
    );
  }

  /**
   * Logs the full actionable payload for stuck-settlement rails: a human
   * operator's only path to act on these is to copy the `batch` field straight
   * out of this log line (via BetterStack) into the Safe Transaction Builder —
   * see docs/runbooks/wallet-and-session-keys.md. No local persistence: the
   * stuck set is entirely re-derivable on-chain, so it's recomputed fresh (and
   * logged in full) on every run rather than tracked across runs.
   */
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

    const batch: Record<string, unknown> = {
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
    };
    (batch.meta as Record<string, unknown>).checksum = keccak256(stringToBytes(JSON.stringify(batch)));

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
