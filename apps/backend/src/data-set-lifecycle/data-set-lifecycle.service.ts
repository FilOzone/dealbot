import {
  createDataSet,
  createDataSetAndAddPieces,
  findPiece,
  type TerminateServiceStatusSuccess,
  terminateService,
  uploadPieceStreaming,
  waitForCreateDataSet,
  waitForCreateDataSetAddPieces,
  waitForTerminateService,
} from "@filoz/synapse-core/sp";
import { Injectable, Logger } from "@nestjs/common";
import { awaitWithAbort } from "../common/abort-utils.js";
import { type ProviderJobContext, toStructuredError } from "../common/logging.js";
import type { Network } from "../common/types.js";
import { buildCheckMetricLabels, classifyFailureStatus } from "../metrics-prometheus/check-metric-labels.js";
import { DataSetLifecycleCheckMetrics } from "../metrics-prometheus/check-metrics.service.js";
import type { SynapseViemClient } from "../wallet-sdk/wallet-sdk.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import type { PDPProviderEx } from "../wallet-sdk/wallet-sdk.types.js";

type LifecycleBaseLogContext = {
  jobId?: string;
  providerAddress: string;
  providerId: bigint;
  providerName: string;
};

/**
 * Provider-relayed termination as a single call: sign + POST the EIP-712
 * authorization (`terminateService`) then poll until the SP confirms it on-chain
 * (`waitForTerminateService`). Replaces the old warm-storage `terminateServiceSync`,
 * which submitted the tx directly — a path that reverts for Safe-multisig payers
 * because the session-key signer is never the on-chain msg.sender (#546).
 */
async function terminateServiceSync(
  client: SynapseViemClient,
  options: { dataSetId: bigint; serviceURL: string; onHash?: (hash: `0x${string}`) => void },
): Promise<TerminateServiceStatusSuccess> {
  const { statusUrl } = await terminateService(client, {
    dataSetId: options.dataSetId,
    serviceURL: options.serviceURL,
  });
  return waitForTerminateService({ statusUrl, onHash: options.onHash });
}

@Injectable()
export class DataSetLifecycleService {
  private readonly logger = new Logger(DataSetLifecycleService.name);

  constructor(
    private readonly walletSdkService: WalletSdkService,
    private readonly lifecycleCheckMetrics: DataSetLifecycleCheckMetrics,
  ) {}

  /**
   * Run one data-set lifecycle check for a provider.
   *
   * Both creation paths run in parallel every tick:
   *
   *   empty variant:
   *     createDataSet → waitForCreateDataSet → terminateServiceSync
   *
   *   with-pieces variant:
   *     uploadPieceStreaming → findPiece →
   *     createDataSetAndAddPieces → waitForCreateDataSetAddPieces → terminateServiceSync
   *
   * Never touches managed check data sets and creates no Deal rows. Throwaway sets are
   * identified by the `dealbotLifecycleCheck` metadata key. If creation succeeds but
   * termination fails the set leaks (accepted trade-off); operators can sweep leaks by key.
   */
  async runLifecycleCheck(
    spAddress: string,
    network: Network,
    metadata: Record<string, string>,
    signal?: AbortSignal,
    jobContext?: ProviderJobContext,
  ): Promise<void> {
    const providerInfo = this.walletSdkService.getProviderInfo(spAddress, network);
    if (!providerInfo) {
      throw new Error(`Provider ${spAddress} not found in registry`);
    }

    const client = this.walletSdkService.getSynapseClient(network);
    if (!client) {
      throw new Error("Synapse client not initialized");
    }

    const baseLogContext: LifecycleBaseLogContext = {
      jobId: jobContext?.jobId,
      providerAddress: spAddress,
      providerId: jobContext?.providerId ?? providerInfo.id,
      providerName: jobContext?.providerName ?? providerInfo.name,
    };

    const labels = buildCheckMetricLabels({
      checkType: "dataSetLifecycleCheck",
      network,
      providerId: providerInfo.id,
      providerName: providerInfo.name,
      providerIsApproved: providerInfo.isApproved,
    });

    const startedAt = Date.now();

    const [emptyResult, withPiecesResult] = await Promise.allSettled([
      this.runEmptyVariant(client, providerInfo, baseLogContext, metadata, signal),
      this.runWithPiecesVariant(client, providerInfo, baseLogContext, metadata, signal),
    ]);

    const errors = [emptyResult, withPiecesResult]
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => r.reason);

    const durationMs = Date.now() - startedAt;

    if (errors.length === 0) {
      this.lifecycleCheckMetrics.observeCheckDuration(labels, durationMs);
      this.lifecycleCheckMetrics.recordStatus(labels, "success");
    } else {
      const status = signal?.aborted ? "failure.timedout" : classifyFailureStatus(errors[0]);
      if (status === "failure.timedout") {
        this.lifecycleCheckMetrics.observeCheckDuration(labels, durationMs);
      }
      this.lifecycleCheckMetrics.recordStatus(labels, status);
      if (errors.length === 1) throw errors[0];
      throw new AggregateError(errors, "One or more lifecycle check variants failed");
    }
  }

  private async runEmptyVariant(
    client: SynapseViemClient,
    providerInfo: PDPProviderEx,
    baseLogContext: LifecycleBaseLogContext,
    metadata: Record<string, string>,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const logContext = { ...baseLogContext, variant: "empty" };

    const startedAt = Date.now();
    this.logger.log({
      event: "dataset_lifecycle_check_started",
      message: "Starting data-set lifecycle check (empty variant)",
      ...logContext,
    });

    let dataSetId: bigint | undefined;
    try {
      signal?.throwIfAborted();

      // 1. Request creation of an empty data set on the SP.
      const createResult = await awaitWithAbort(
        createDataSet(client, {
          cdn: false,
          payee: providerInfo.payee,
          serviceURL: providerInfo.pdp.serviceURL,
          metadata,
        }),
        signal,
      );
      signal?.throwIfAborted();

      this.logger.log({
        event: "dataset_lifecycle_check_creating",
        message: "Empty data set creation submitted; waiting for SP confirmation",
        ...logContext,
        txHash: createResult.txHash,
      });

      // 2. Wait for the SP to confirm the data set is created and extract the dataSetId.
      const confirmed = await awaitWithAbort(waitForCreateDataSet({ statusUrl: createResult.statusUrl }), signal);
      dataSetId = confirmed.dataSetId;
      signal?.throwIfAborted();

      this.logger.log({
        event: "dataset_lifecycle_check_created",
        message: "Empty data set created and confirmed on-chain",
        ...logContext,
        dataSetId: dataSetId.toString(),
      });

      // 3. Immediately terminate the throwaway data set.
      await awaitWithAbort(
        terminateServiceSync(client, {
          dataSetId,
          serviceURL: providerInfo.pdp.serviceURL,
          onHash: (hash) => {
            this.logger.log({
              event: "dataset_lifecycle_check_terminating",
              message: "Terminate transaction submitted",
              ...logContext,
              dataSetId: (dataSetId as bigint).toString(),
              txHash: hash,
            });
          },
        }),
        signal,
      );

      const durationMs = Date.now() - startedAt;
      this.logger.log({
        event: "dataset_lifecycle_check_succeeded",
        message: "Data-set lifecycle check completed (empty variant)",
        ...logContext,
        dataSetId: dataSetId.toString(),
        durationMs,
      });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const status = signal?.aborted ? "failure.timedout" : classifyFailureStatus(error);
      this.logger.error({
        event: "dataset_lifecycle_check_failed",
        message:
          dataSetId === undefined
            ? "Data-set lifecycle check failed during creation (empty variant)"
            : "Data-set lifecycle check failed during termination; throwaway data set may have leaked",
        ...logContext,
        dataSetId: dataSetId?.toString(),
        durationMs,
        status,
        error: toStructuredError(error),
      });
      throw error;
    }
  }

  private async runWithPiecesVariant(
    client: SynapseViemClient,
    providerInfo: PDPProviderEx,
    baseLogContext: LifecycleBaseLogContext,
    metadata: Record<string, string>,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const logContext = { ...baseLogContext, variant: "withPieces" };

    const startedAt = Date.now();
    this.logger.log({
      event: "dataset_with_pieces_lifecycle_check_started",
      message: "Starting data-set lifecycle check (with-pieces variant)",
      ...logContext,
    });

    let dataSetId: bigint | undefined;
    try {
      signal?.throwIfAborted();

      // 1. Upload the canary piece to the SP's HTTP storage service.
      //    Random bytes per call prevent SP-side piece caching from masking storage failures.
      const canaryPiece = new Uint8Array(256);
      crypto.getRandomValues(canaryPiece);
      const { pieceCid } = await awaitWithAbort(
        uploadPieceStreaming({
          serviceURL: providerInfo.pdp.serviceURL,
          data: canaryPiece,
          signal,
        }),
        signal,
      );
      signal?.throwIfAborted();

      this.logger.log({
        event: "dataset_with_pieces_lifecycle_check_piece_uploaded",
        message: "Canary piece uploaded; verifying SP has ingested it",
        ...logContext,
        pieceCid: pieceCid.toString(),
      });

      // 2. Verify the SP has ingested the piece before submitting the on-chain transaction.
      //    findPiece with retry polls until the SP confirms availability, catching upload
      //    processing delays that would otherwise cause createDataSetAndAddPieces to fail.
      await awaitWithAbort(
        findPiece({
          serviceURL: providerInfo.pdp.serviceURL,
          pieceCid,
          poll: true,
          signal,
        }),
        signal,
      );
      signal?.throwIfAborted();

      // 3. Atomically create the data set and register the piece on-chain.
      const createResult = await awaitWithAbort(
        createDataSetAndAddPieces(client, {
          cdn: false,
          payee: providerInfo.payee,
          serviceURL: providerInfo.pdp.serviceURL,
          pieces: [{ pieceCid }],
          metadata,
        }),
        signal,
      );
      signal?.throwIfAborted();

      this.logger.log({
        event: "dataset_with_pieces_lifecycle_check_creating",
        message: "Data set with piece submitted; waiting for SP confirmation",
        ...logContext,
        txHash: createResult.txHash,
        pieceCid: pieceCid.toString(),
      });

      // 4. Wait for on-chain confirmation of both data set creation and piece addition.
      const confirmed = await awaitWithAbort(
        waitForCreateDataSetAddPieces({ statusUrl: createResult.statusUrl }),
        signal,
      );
      dataSetId = confirmed.dataSetId;
      signal?.throwIfAborted();

      this.logger.log({
        event: "dataset_with_pieces_lifecycle_check_created",
        message: "Data set with piece created and confirmed on-chain",
        ...logContext,
        dataSetId: dataSetId.toString(),
        piecesIds: confirmed.piecesIds.map(String),
      });

      // 5. Immediately terminate the throwaway data set.
      await awaitWithAbort(
        terminateServiceSync(client, {
          dataSetId,
          serviceURL: providerInfo.pdp.serviceURL,
          onHash: (hash) => {
            this.logger.log({
              event: "dataset_with_pieces_lifecycle_check_terminating",
              message: "Terminate transaction submitted",
              ...logContext,
              dataSetId: (dataSetId as bigint).toString(),
              txHash: hash,
            });
          },
        }),
        signal,
      );

      const durationMs = Date.now() - startedAt;
      this.logger.log({
        event: "dataset_with_pieces_lifecycle_check_succeeded",
        message: "Data-set lifecycle check completed (with-pieces variant)",
        ...logContext,
        dataSetId: dataSetId.toString(),
        durationMs,
      });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const status = signal?.aborted ? "failure.timedout" : classifyFailureStatus(error);
      this.logger.error({
        event: "dataset_with_pieces_lifecycle_check_failed",
        message:
          dataSetId === undefined
            ? "Data-set lifecycle check failed before data set was confirmed (with-pieces variant)"
            : "Data-set lifecycle check failed during termination; throwaway data set may have leaked",
        ...logContext,
        dataSetId: dataSetId?.toString(),
        durationMs,
        status,
        error: toStructuredError(error),
      });
      throw error;
    }
  }
}
