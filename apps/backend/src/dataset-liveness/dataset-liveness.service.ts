import { asChain } from "@filoz/synapse-core/chains";
import { Injectable, Logger } from "@nestjs/common";
import type { Account, Chain, Client, Transport } from "viem";
import { readContract } from "viem/actions";
import { awaitWithAbort } from "../common/abort-utils.js";
import { toStructuredError } from "../common/logging.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";

type SynapseViemClient = Client<Transport, Chain, Account>;

const PDP_LIVENESS_PROBE_TIMEOUT_MS = 10_000;

/**
 * Composite PDP-liveness probe. Two independent probes:
 *
 *   - FWSS `validateDataSet` (chain): wraps `PDPVerifier.dataSetLive` via
 *     multicall and additionally verifies the listener is this WarmStorage
 *     contract, so it covers chain-side liveness fully.
 *   - SP HTTP `POST /pdp/data-sets/{id}/pieces` (off-chain): catches Curio's
 *     `unrecoverable_proving_failure_epoch` state, which precedes chain
 *     propagation and is the only signal observable when the SP refuses
 *     addPieces but chain still reports the set as live.
 *
 * If any settled result is `false`, returns `false` even when the other
 * probe threw a transient error. Otherwise rethrows the first rejection so
 * a probe outage is not silently misclassified as live.
 */
@Injectable()
export class DatasetLivenessService {
  private readonly logger = new Logger(DatasetLivenessService.name);

  constructor(private readonly walletSdkService: WalletSdkService) {}

  async isDataSetLive(providerAddress: string, dataSetId: bigint, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted();
    const settled = await Promise.allSettled([
      this.probeFwssDataSetLive(dataSetId, signal),
      this.probeSpHttpDataSetLive(providerAddress, dataSetId, signal),
    ]);
    if (settled.some((r) => r.status === "fulfilled" && r.value === false)) {
      return false;
    }
    const rejection = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (rejection) throw rejection.reason;
    return true;
  }

  /**
   * On-chain check that a specific piece is still expected to be retrievable.
   *
   * Wraps `PDPVerifier.pieceLive(setId, pieceId)`, which returns:
   *   `dataSetLive(setId) && pieceId < nextPieceId[setId] && pieceLeafCounts[setId][pieceId] > 0`
   *
   * So `false` covers three legitimate reasons the SP can answer 404:
   *   1. Dataset terminated.
   *   2. Piece ID never created.
   *   3. Piece hard-removed (`removePieces` finalized; leaf count zeroed).
   *
   * Pieces that are scheduled for removal but not yet finalized still return
   * `true` — the SP remains on the hook for challenges until the next
   * proving period clears the scheduledRemovals queue, so it must still
   * serve GET requests.
   *
   * Source: `FilOzone/pdp` PDPVerifier.sol `pieceLive`.
   */
  async isPieceLive(dataSetId: bigint, pieceId: bigint, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted();
    const client = this.walletSdkService.getSynapseClient() as SynapseViemClient | null;
    if (!client) {
      throw new Error("Synapse client not available for pieceLive read");
    }
    const chain = asChain(client.chain);
    const result = await awaitWithAbort(
      readContract(client, {
        abi: chain.contracts.pdp.abi,
        address: chain.contracts.pdp.address,
        functionName: "pieceLive",
        args: [dataSetId, pieceId],
      }),
      signal,
    );
    return Boolean(result);
  }

  protected async probeFwssDataSetLive(dataSetId: bigint, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted();
    const { warmStorageService } = this.walletSdkService.getWalletServices();
    try {
      await awaitWithAbort(warmStorageService.validateDataSet({ dataSetId }), signal);
      return true;
    } catch (error) {
      if (signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (/does not exist or is not live/i.test(message)) {
        return false;
      }
      throw error;
    }
  }

  protected async probeSpHttpDataSetLive(
    providerAddress: string,
    dataSetId: bigint,
    signal?: AbortSignal,
  ): Promise<boolean> {
    signal?.throwIfAborted();
    const providerInfo = this.walletSdkService.getProviderInfo(providerAddress);
    if (!providerInfo) {
      throw new Error(`Provider ${providerAddress} not found in registry`);
    }
    const serviceURL = providerInfo.pdp?.serviceURL;
    if (!serviceURL) {
      throw new Error(`Provider ${providerAddress} has no PDP serviceURL`);
    }
    const url = new URL(`pdp/data-sets/${dataSetId.toString()}/pieces`, serviceURL);
    const timeoutSignal = AbortSignal.timeout(PDP_LIVENESS_PROBE_TIMEOUT_MS);
    const probeSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: probeSignal,
      });
      if (res.status !== 409) return true;
      const body = await res.text();
      return !/unrecoverable proving failure/i.test(body);
    } catch (error) {
      if (signal?.aborted) throw error;
      this.logger.warn({
        event: "dataset_sp_liveness_probe_failed",
        message: "SP HTTP liveness probe failed; treating dataset as live",
        providerAddress,
        providerId: providerInfo.id,
        dataSetId: dataSetId.toString(),
        serviceURL,
        error: toStructuredError(error),
      });
      return true;
    }
  }
}
