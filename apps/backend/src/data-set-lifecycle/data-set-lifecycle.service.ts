import { createDataSet, waitForCreateDataSet } from "@filoz/synapse-core/sp";
import { terminateServiceSync } from "@filoz/synapse-core/warm-storage";
import { Injectable, Logger } from "@nestjs/common";
import { awaitWithAbort } from "../common/abort-utils.js";
import { toStructuredError } from "../common/logging.js";
import { buildCheckMetricLabels, classifyFailureStatus } from "../metrics-prometheus/check-metric-labels.js";
import { DataSetLifecycleCheckMetrics } from "../metrics-prometheus/check-metrics.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";

@Injectable()
export class DataSetLifecycleService {
  private readonly logger = new Logger(DataSetLifecycleService.name);

  constructor(
    private readonly walletSdkService: WalletSdkService,
    private readonly lifecycleCheckMetrics: DataSetLifecycleCheckMetrics,
  ) {}

  /**
   * Run one data-set lifecycle check: create an empty throwaway data set on the SP,
   * wait for on-chain confirmation, then immediately terminate it. Used by the
   * `data_set_lifecycle_check` canary job to validate that an SP honours the full
   * create → terminate lifecycle.
   *
   * Never touches managed check data sets and creates no Deal rows. The throwaway set
   * is identified by the fixed `dealbotLifecycleCheck` marker key in `metadata`; a
   * per-run nonce value prevents accidentally reusing a prior leaked set. If creation
   * succeeds but termination fails the set leaks (accepted trade-off); operators can
   * sweep leaks by that key.
   *
   * Emits only `dataSetLifecycleCheckStatus` / `dataSetLifecycleCheckMs` metrics.
   */
  async runLifecycleCheck(spAddress: string, metadata: Record<string, string>, signal?: AbortSignal): Promise<void> {
    const providerInfo = this.walletSdkService.getProviderInfo(spAddress);
    if (!providerInfo) {
      throw new Error(`Provider ${spAddress} not found in registry`);
    }

    const client = this.walletSdkService.getSynapseClient();
    if (!client) {
      throw new Error("Synapse client not initialized");
    }

    const labels = buildCheckMetricLabels({
      checkType: "dataSetLifecycleCheck",
      providerId: providerInfo.id,
      providerName: providerInfo.name,
      providerIsApproved: providerInfo.isApproved,
    });

    const logContext = {
      providerAddress: spAddress,
      providerName: providerInfo.name,
      providerId: providerInfo.id,
    };

    const startedAt = Date.now();
    this.logger.log({
      event: "dataset_lifecycle_check_started",
      message: "Starting data-set lifecycle check",
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
      this.lifecycleCheckMetrics.observeCheckDuration(labels, durationMs);
      this.lifecycleCheckMetrics.recordStatus(labels, "success");

      this.logger.log({
        event: "dataset_lifecycle_check_succeeded",
        message: "Data-set lifecycle check completed: created and terminated throwaway data set",
        ...logContext,
        dataSetId: dataSetId.toString(),
        durationMs,
      });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const status = signal?.aborted ? "failure.timedout" : classifyFailureStatus(error);
      if (status === "failure.timedout") {
        this.lifecycleCheckMetrics.observeCheckDuration(labels, durationMs);
      }
      this.lifecycleCheckMetrics.recordStatus(labels, status);
      this.logger.error({
        event: "dataset_lifecycle_check_failed",
        message:
          dataSetId === undefined
            ? "Data-set lifecycle check failed during creation"
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
