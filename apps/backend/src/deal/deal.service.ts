import { randomUUID } from "node:crypto";
import { METADATA_KEYS, SIZE_CONSTANTS, Synapse } from "@filoz/synapse-sdk";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { executeUpload } from "filecoin-pin";
import { CID } from "multiformats/cid";
import type { Repository } from "typeorm";
import { ClickhouseService } from "../clickhouse/clickhouse.service.js";
import { awaitWithAbort } from "../common/abort-utils.js";
import { buildUnixfsCar } from "../common/car-utils.js";
import { DealJobTerminatedDataSetError } from "../common/errors.js";
import { createFilecoinPinLogger } from "../common/filecoin-pin-logger.js";
import {
  type DealLogContext,
  type ProviderJobContext,
  redactSensitiveText,
  toStructuredError,
} from "../common/logging.js";
import { createSynapseFromConfig } from "../common/synapse-factory.js";
import type { DataFile, Hex, Network } from "../common/types.js";
import type { IConfig, INetworkConfig } from "../config/types.js";
import { Deal } from "../database/entities/deal.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { DealStatus, IpniStatus, ServiceType } from "../database/types.js";
import { DataSourceService } from "../dataSource/dataSource.service.js";
import { DatasetLivenessService } from "../dataset-liveness/dataset-liveness.service.js";
import { DealAddonsService } from "../deal-addons/deal-addons.service.js";
import type { DealPreprocessingResult } from "../deal-addons/types.js";
import { buildCheckMetricLabels, classifyFailureStatus } from "../metrics-prometheus/check-metric-labels.js";
import {
  DataSetCreationCheckMetrics,
  DataStorageCheckMetrics,
  RetrievalCheckMetrics,
} from "../metrics-prometheus/check-metrics.service.js";
import { RetrievalAddonsService } from "../retrieval-addons/retrieval-addons.service.js";
import type { RetrievalConfiguration, RetrievalExecutionResult } from "../retrieval-addons/types.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import type { PDPProviderEx } from "../wallet-sdk/wallet-sdk.types.js";

type UploadPayload = {
  carData: Uint8Array;
  rootCid: CID;
};

type UploadResultSummary = {
  pieceCid: string;
  pieceId?: number;
  transactionHash?: string;
};

@Injectable()
export class DealService {
  private readonly logger = new Logger(DealService.name);

  constructor(
    private readonly dataSourceService: DataSourceService,
    private readonly configService: ConfigService<IConfig, true>,
    private readonly walletSdkService: WalletSdkService,
    private readonly dealAddonsService: DealAddonsService,
    private readonly retrievalAddonsService: RetrievalAddonsService,
    @InjectRepository(Deal)
    private readonly dealRepository: Repository<Deal>,
    @InjectRepository(StorageProvider)
    private readonly storageProviderRepository: Repository<StorageProvider>,
    private readonly dataStorageMetrics: DataStorageCheckMetrics,
    private readonly retrievalMetrics: RetrievalCheckMetrics,
    private readonly dataSetCreationMetrics: DataSetCreationCheckMetrics,
    private readonly clickhouseService: ClickhouseService,
    private readonly datasetLivenessService: DatasetLivenessService,
  ) {}

  private getNetworkConfig(network: Network): INetworkConfig {
    return this.configService.get("networks")[network];
  }

  async createDealForProvider(
    pdpProvider: PDPProviderEx,
    options: {
      network: Network;
      existingDealId?: string;
      signal?: AbortSignal;
      logContext?: ProviderJobContext;
    },
  ): Promise<Deal> {
    options.signal?.throwIfAborted();

    const extraDataSetMetadata = await this.resolveDataSetMetadataForDeal(
      pdpProvider.serviceProvider,
      options.network,
      options.signal,
      options.logContext,
    );

    const { preprocessed, cleanup } = await this.prepareDealInput(options.signal, options.logContext);

    try {
      const synapse =
        this.walletSdkService.tryGetSynapse(options.network) ?? (await this.createSynapseInstance(options.network));
      const uploadPayload = await this.prepareUploadPayload(preprocessed, options.signal);
      return await this.createDeal(
        synapse,
        pdpProvider,
        preprocessed,
        uploadPayload,
        options.network,
        options.existingDealId,
        options.signal,
        extraDataSetMetadata,
        options.logContext,
      );
    } finally {
      await cleanup();
    }
  }

  /**
   * Pick which data-set slot this deal will target.
   *
   * Policy:
   *   - If `minNumDataSetsForChecks > 1` and a random index > 0 is selected,
   *     probe that slot first. If live, use it. If missing or terminated,
   *     fall through to baseline (data_set_creation owns repair/provisioning).
   *   - Probe baseline. If terminated, throw `DealJobTerminatedDataSetError`
   *     (baseline is the fallback target; nothing else to try).
   *   - Live or missing baseline → return `undefined` (use baseline slot).
   *
   * The post-`createContext` `isDataSetLive` guard inside `createDeal` runs on
   * the exact `dataSetId` the upload will use, and is the safety net for any
   * caller of `createDealForProvider` that did not run this probe first.
   */
  async resolveDataSetMetadataForDeal(
    providerAddress: string,
    network: Network,
    signal?: AbortSignal,
    logContext?: ProviderJobContext,
  ): Promise<Record<string, string> | undefined> {
    signal?.throwIfAborted();
    const baseDataSetMetadata = this.getBaseDataSetMetadata(network);

    const indexedMetadata = await this.tryIndexedDataSetSlot(
      providerAddress,
      baseDataSetMetadata,
      network,
      signal,
      logContext,
    );
    if (indexedMetadata !== undefined) return indexedMetadata;

    try {
      const baselineStatus = await this.getDataSetProvisioningStatus(
        providerAddress,
        baseDataSetMetadata,
        network,
        signal,
      );
      if (baselineStatus.status === "terminated") {
        throw new DealJobTerminatedDataSetError(baselineStatus.dataSetId);
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof DealJobTerminatedDataSetError) throw error;
      this.logger.warn({
        ...logContext,
        event: "deal_job_dataset_check_failed",
        message: "Failed to verify baseline data set; proceeding to attempt deal",
        error: toStructuredError(error),
      });
    }

    return undefined;
  }

  private async tryIndexedDataSetSlot(
    providerAddress: string,
    baseDataSetMetadata: Record<string, string>,
    network: Network,
    signal: AbortSignal | undefined,
    logContext: ProviderJobContext | undefined,
  ): Promise<Record<string, string> | undefined> {
    const minDataSets = this.getNetworkConfig(network).minNumDataSetsForChecks;
    if (minDataSets <= 1) return undefined;
    const dsIndex = Math.floor(Math.random() * minDataSets);
    if (dsIndex === 0) return undefined;

    const dsIndexMetadata = { dealbotDS: String(dsIndex) };
    try {
      const status = await this.getDataSetProvisioningStatus(
        providerAddress,
        { ...baseDataSetMetadata, ...dsIndexMetadata },
        network,
        signal,
      );
      if (status.status === "live") return dsIndexMetadata;
      if (status.status === "terminated") {
        this.logger.warn({
          ...logContext,
          event: "deal_job_dataset_index_terminated",
          message: "Selected data set index is PDP-terminated; falling back to baseline",
          dataSetIndex: dsIndex,
          dataSetId: status.dataSetId.toString(),
        });
      } else {
        this.logger.log({
          ...logContext,
          event: "deal_job_dataset_fallback",
          message: "Data set not yet provisioned; falling back to default data set",
          dataSetIndex: dsIndex,
        });
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      this.logger.warn({
        ...logContext,
        event: "deal_job_dataset_check_failed",
        message: "Failed to verify data set: falling back to default data set",
        dataSetIndex: dsIndex,
        error: toStructuredError(error),
      });
    }
    return undefined;
  }

  /**
   * Prepare a deal payload using the same data-source and preprocessing logic as normal deal creation.
   * IPNI is always enabled for all deals.
   */
  async prepareDealInput(
    signal?: AbortSignal,
    logContext?: ProviderJobContext,
  ): Promise<{ preprocessed: DealPreprocessingResult; cleanup: () => Promise<void> }> {
    const dataFile = await this.fetchDataFile(SIZE_CONSTANTS.MIN_UPLOAD_SIZE, SIZE_CONSTANTS.MAX_UPLOAD_SIZE);

    const preprocessed = await this.dealAddonsService.preprocessDeal(
      {
        enableIpni: true,
        dataFile,
      },
      signal,
      logContext,
    );

    const cleanup = async () => this.dataSourceService.cleanupRandomDataset(dataFile.name);

    return { preprocessed, cleanup };
  }

  getBaseDataSetMetadata(network: Network): Record<string, string> {
    // IPNI is always enabled for all deals
    const metadata: Record<string, string> = {
      [METADATA_KEYS.WITH_IPFS_INDEXING]: "",
    };
    const networkConfig = this.getNetworkConfig(network);
    if (networkConfig.dealbotDataSetVersion) {
      metadata.dealbotDataSetVersion = networkConfig.dealbotDataSetVersion;
    }
    return metadata;
  }

  getWalletAddress(network: Network): string {
    return this.getNetworkConfig(network).walletAddress;
  }

  async createDeal(
    synapse: Synapse,
    pdpProvider: PDPProviderEx,
    dealInput: DealPreprocessingResult,
    uploadPayload: UploadPayload,
    network: Network,
    existingDealId?: string,
    signal?: AbortSignal,
    extraDataSetMetadata?: Record<string, string>,
    logContext?: ProviderJobContext,
  ): Promise<Deal> {
    const providerAddress = pdpProvider.serviceProvider;
    const checkType = "dataStorage" as const;
    let providerLabels = buildCheckMetricLabels({
      checkType,
      network,
      providerId: pdpProvider.id,
      providerName: pdpProvider.name,
      providerIsApproved: pdpProvider.isApproved,
    });
    let uploadSucceeded = false;
    let onchainSucceeded = false;
    let retrievalStarted = false;
    let retrievalStatusEmitted = false;
    let preUploadTerminated = false;
    let dataStorageStatusEmitted = false;
    let retrievalResults: RetrievalExecutionResult[] = [];

    let deal: Deal;
    if (existingDealId) {
      const existingDeal = await this.dealRepository.findOne({
        where: { id: existingDealId },
      });
      if (!existingDeal) {
        const error = new Error(`Deal not found: ${existingDealId}`);
        this.logger.error({
          ...logContext,
          jobId: logContext?.jobId,
          dealId: existingDealId,
          providerAddress,
          providerId: pdpProvider.id ?? logContext?.providerId,
          ipfsRootCID: uploadPayload.rootCid.toString(),
          event: "deal_creation_failed",
          message: "Deal creation failed",
          error: toStructuredError(error),
        });
        throw error;
      }
      deal = existingDeal;
    } else {
      deal = this.dealRepository.create();
      // Set a deterministic ID early so all logs in this run share a stable dealId.
      deal.id = randomUUID();
    }

    const networkCfg = this.getNetworkConfig(network);
    deal.fileName = dealInput.processedData.name;
    deal.fileSize = dealInput.processedData.size;
    deal.spAddress = providerAddress;
    deal.network = network;
    deal.status = DealStatus.PENDING;
    deal.walletAddress = networkCfg.walletAddress;
    deal.metadata = dealInput.metadata;
    deal.serviceTypes = dealInput.appliedAddons;

    const dealLogContext: DealLogContext = {
      ...logContext,
      dealId: existingDealId ?? deal.id,
      providerAddress,
      providerId: pdpProvider.id ?? logContext?.providerId,
      providerName: pdpProvider.name ?? logContext?.providerName,
      ipfsRootCID: uploadPayload.rootCid.toString(),
    };

    /** Cancels detached onStored addons when executeUpload fails. See #503. */
    const addonAbortCtrl = new AbortController();
    const addonSignal: AbortSignal = signal ? AbortSignal.any([signal, addonAbortCtrl.signal]) : addonAbortCtrl.signal;
    /** Wrapper object so TS preserves the union type across closure mutation. */
    const onStoredAddons: { promise: Promise<boolean> | null } = { promise: null };
    let addonsAwaited = false;
    let storedError: Error | undefined;

    try {
      // Load storageProvider relation
      deal.storageProvider = await this.storageProviderRepository.findOne({
        where: { address: deal.spAddress, network: deal.network },
      });
      dealLogContext.providerId = deal.storageProvider?.providerId ?? dealLogContext.providerId;
      providerLabels = buildCheckMetricLabels({
        checkType,
        network,
        providerId: deal.storageProvider?.providerId,
        providerName: pdpProvider.name ?? deal.storageProvider?.name,
        providerIsApproved: pdpProvider.isApproved ?? deal.storageProvider?.isApproved,
      });

      const dataSetMetadata = { ...dealInput.synapseConfig.dataSetMetadata, ...extraDataSetMetadata };

      if (networkCfg.dealbotDataSetVersion) {
        dataSetMetadata.dealbotDataSetVersion = networkCfg.dealbotDataSetVersion;
      }
      const filecoinPinLogger = createFilecoinPinLogger(this.logger, dealLogContext);

      signal?.throwIfAborted();

      const storage = await synapse.storage.createContext({
        providerId: dealLogContext.providerId,
        metadata: dataSetMetadata,
      });
      signal?.throwIfAborted();

      // PDP can mark a data set terminated while FWSS still has
      // pdpEndEpoch=0; createContext returns it and the next add-pieces path
      // would fail. See #379.
      if (storage.dataSetId !== undefined) {
        const live = await this.isDataSetLive(providerAddress, storage.dataSetId, network, signal);
        if (!live) {
          preUploadTerminated = true;
          throw new DealJobTerminatedDataSetError(storage.dataSetId);
        }
      }

      this.dataStorageMetrics.recordUploadStatus(providerLabels, "pending");
      this.dataStorageMetrics.recordDataStorageStatus(providerLabels, "pending");

      deal.dataSetId = storage.dataSetId ?? null;
      deal.uploadStartTime = new Date();

      const uploadResult = await awaitWithAbort(
        executeUpload(synapse, uploadPayload.carData, uploadPayload.rootCid, {
          logger: filecoinPinLogger,
          contextId: providerAddress,
          pieceMetadata: dealInput.synapseConfig.pieceMetadata,
          contexts: [storage],
          signal,
          /**
           * do not do IPNI validation here, we need to call /pdp/piece/<pieceCid>/status to get other metrics.
           * See `onStored` handler in deal-addons/strategies/ipni.strategy.ts for implementation.
           */
          ipniValidation: { enabled: false },
          // Must stay synchronous — Synapse SDK's safeInvoke discards the returned promise. See issue #446.
          onProgress: (event) => {
            this.logger.debug({
              ...dealLogContext,
              event: "upload_progress",
              message: "Upload in progress",
              filecoinPinEventType: event.type,
            });
            switch (event.type) {
              case "stored": {
                deal.uploadEndTime = new Date();
                deal.status = DealStatus.UPLOADED;
                deal.ingestLatencyMs = null;
                deal.ingestThroughputBps = null;

                const uploadStartTime = deal.uploadStartTime;
                const uploadEndTime = deal.uploadEndTime;
                if (uploadStartTime == null) {
                  this.logger.warn({
                    ...dealLogContext,
                    event: "ingest_metrics_skipped_missing_upload_start_time",
                    message: "Skipping ingest metrics: uploadStartTime is missing",
                    uploadEndTime,
                  });
                } else {
                  const ingestLatencyMs = uploadEndTime.getTime() - uploadStartTime.getTime();
                  if (!Number.isFinite(ingestLatencyMs) || ingestLatencyMs <= 0) {
                    this.logger.warn({
                      ...dealLogContext,
                      event: "ingest_metrics_skipped_invalid_latency",
                      message: "Skipping ingest metrics: invalid ingest latency",
                      uploadStartTime,
                      uploadEndTime,
                      ingestLatencyMs,
                    });
                  } else {
                    deal.ingestLatencyMs = ingestLatencyMs;
                    this.dataStorageMetrics.observeIngestMs(providerLabels, ingestLatencyMs);

                    const ingestSeconds = ingestLatencyMs / 1000;
                    const ingestThroughputBps = Math.round(deal.fileSize / ingestSeconds);
                    if (!Number.isFinite(ingestThroughputBps) || ingestThroughputBps <= 0) {
                      this.logger.warn({
                        ...dealLogContext,
                        event: "ingest_throughput_skipped_invalid_value",
                        message: "Skipping ingest throughput metric: invalid throughput value",
                        ingestLatencyMs,
                        fileSize: deal.fileSize,
                        ingestThroughputBps,
                      });
                    } else {
                      deal.ingestThroughputBps = ingestThroughputBps;
                      this.dataStorageMetrics.observeIngestThroughput(providerLabels, ingestThroughputBps);
                    }
                  }
                }

                deal.pieceCid = event.data.pieceCid.toString();
                dealLogContext.pieceCid = event.data.pieceCid.toString();
                this.logger.log({
                  ...dealLogContext,
                  event: "stored",
                  message: `Store completed`,
                });
                uploadSucceeded = true;
                this.dataStorageMetrics.recordUploadStatus(providerLabels, "success");
                this.dataStorageMetrics.recordOnchainStatus(providerLabels, "pending");
                onStoredAddons.promise = this.dealAddonsService
                  .handleStored(deal, dealInput.appliedAddons, addonSignal, dealLogContext)
                  .then(() => true)
                  .catch((error) => {
                    storedError = error;
                    return false;
                  });
                break;
              }
              case "piecesAdded":
                this.logger.log({
                  ...dealLogContext,
                  event: "pieces_added",
                  message: "Pieces added",
                  txHash: event.data.txHash,
                });
                deal.piecesAddedTime = new Date();
                if (event.data.txHash != null) {
                  deal.transactionHash = event.data.txHash as Hex;
                } else {
                  this.logger.warn({
                    ...dealLogContext,
                    event: "pieces_added_no_tx_hash",
                    message: "No transaction hash found for pieces added event",
                  });
                }
                deal.status = DealStatus.PIECE_ADDED;
                if (deal.uploadEndTime) {
                  this.dataStorageMetrics.observePieceAddedOnChainMs(
                    providerLabels,
                    deal.piecesAddedTime.getTime() - deal.uploadEndTime.getTime(),
                  );
                }
                break;
              case "piecesConfirmed":
                this.logger.log({
                  ...dealLogContext,
                  event: "pieces_confirmed",
                  message: "Pieces confirmed",
                  pieceIds: event.data.pieceIds,
                });
                if (event.data.pieceIds.length > 1) {
                  this.logger.warn({
                    ...dealLogContext,
                    event: "pieces_confirmed_multiple_piece_ids",
                    message: "Expected at most one pieceId for dealbot content, received multiple",
                    pieceIds: event.data.pieceIds,
                  });
                }
                if (event.data.pieceIds.length > 0) {
                  deal.pieceId = Number(event.data.pieceIds[0]);
                }
                deal.piecesConfirmedTime = new Date();
                deal.status = DealStatus.PIECE_CONFIRMED;
                deal.chainLatencyMs =
                  deal.piecesAddedTime != null
                    ? deal.piecesConfirmedTime.getTime() - deal.piecesAddedTime.getTime()
                    : null;
                onchainSucceeded = true;
                if (deal.chainLatencyMs !== null) {
                  this.dataStorageMetrics.observePieceConfirmedOnChainMs(providerLabels, deal.chainLatencyMs);
                }
                this.dataStorageMetrics.recordOnchainStatus(providerLabels, "success");
                break;
            }
          },
        }),
        signal,
      );
      signal?.throwIfAborted();
      const pieceCid = deal.pieceCid;
      const uploadStartTime = deal.uploadStartTime;
      const uploadEndTime = deal.uploadEndTime;
      const pieceAddedTime = deal.piecesAddedTime;
      const pieceConfirmedTime = deal.piecesConfirmedTime;
      if (
        pieceCid === null ||
        uploadStartTime === null ||
        uploadEndTime === null ||
        pieceAddedTime === null ||
        pieceConfirmedTime === null
      ) {
        throw new Error("Dealbot did not receive onProgress events during upload");
      }

      deal.dealLatencyMs = pieceConfirmedTime.getTime() - uploadStartTime.getTime();

      if (!deal.transactionHash) {
        this.logger.error({
          ...dealLogContext,
          event: "deal_transaction_hash_missing",
          message: "No transaction hash found for deal",
        });
      }

      this.updateDealWithUploadResult(deal, uploadResult, uploadPayload.carData.length);

      // wait for onStored handlers to complete
      if (onStoredAddons.promise != null) {
        const storedOk = await onStoredAddons.promise;
        addonsAwaited = true;
        if (!storedOk) {
          throw storedError ?? new Error("Upload completion handlers failed");
        }
        deal.dealConfirmedTime = new Date();
        if (deal.ipniVerifiedAt != null && deal.uploadStartTime != null) {
          // pieceUploadToRetrievableDuration (IPNI verified)
          deal.dealLatencyWithIpniMs = deal.ipniVerifiedAt.getTime() - deal.uploadStartTime.getTime();
        }
        // throw if aborted after saving dealConfirmedTime and dealLatencyWithIpniMs
        signal?.throwIfAborted();
      }

      const retrievalConfig: RetrievalConfiguration = {
        deal,
        walletAddress: deal.walletAddress as Hex,
        storageProvider: deal.spAddress as Hex,
      };
      const retrievalStartTime = Date.now();
      retrievalStarted = true;
      this.retrievalMetrics.recordStatus(providerLabels, "pending");
      signal?.throwIfAborted();
      const retrievalTest = await this.retrievalAddonsService.testAllRetrievalMethods(
        retrievalConfig,
        signal,
        dealLogContext,
      );
      signal?.throwIfAborted();
      retrievalResults = retrievalTest.results;

      this.retrievalMetrics.recordResultMetrics(retrievalTest.results, providerLabels);
      this.retrievalMetrics.recordStatus(
        providerLabels,
        retrievalTest.summary.totalMethods > 0 && retrievalTest.summary.failedMethods === 0
          ? "success"
          : "failure.other",
      );
      retrievalStatusEmitted = true;

      if (retrievalTest.summary.failedMethods > 0) {
        throw new Error(
          `Retrieval gate failed: ${retrievalTest.summary.failedMethods}/${retrievalTest.summary.totalMethods} methods failed`,
        );
      } else if (retrievalTest.summary.totalMethods === 0) {
        throw new Error("No retrieval methods to test");
      } else {
        this.logger.log({
          ...dealLogContext,
          event: "deal_creation_retrieval_test_completed",
          message: "Retrieval test completed",
          durationMs: retrievalTest.testedAt.getTime() - retrievalStartTime,
          totalMethods: retrievalTest.summary.totalMethods,
          successfulMethods: retrievalTest.summary.successfulMethods,
        });
      }

      deal.status = DealStatus.DEAL_CREATED;
      if (deal.uploadStartTime) {
        const checkDurationMs = Date.now() - deal.uploadStartTime.getTime();
        this.dataStorageMetrics.observeCheckDuration(providerLabels, checkDurationMs);
      }
      this.dataStorageMetrics.recordDataStorageStatus(providerLabels, "success");
      dataStorageStatusEmitted = true;

      this.logger.log({
        ...dealLogContext,
        event: "deal_creation_completed",
        message: "Deal created",
      });

      await this.dealAddonsService.postProcessDeal(deal, dealInput.appliedAddons, dealLogContext);

      return deal;
    } catch (error) {
      if (preUploadTerminated && error instanceof DealJobTerminatedDataSetError) {
        this.logger.warn({
          ...dealLogContext,
          event: "dataset_unhealthy_waiting_for_data_set_creation",
          message: "Data set is PDP-terminated; deferring deal job to data_set_creation repair",
          dataSetId: error.dataSetId.toString(),
        });
        throw error;
      }

      const errorMessage = redactSensitiveText(error instanceof Error ? error.message : String(error));
      this.logger.error({
        ...dealLogContext,
        event: "deal_creation_failed",
        message: "Deal creation failed",
        error: toStructuredError(error),
      });
      const failureStatus = classifyFailureStatus(error);

      deal.status = DealStatus.FAILED;
      deal.errorMessage = errorMessage;

      if (!uploadSucceeded) {
        this.dataStorageMetrics.recordUploadStatus(providerLabels, failureStatus);
      } else if (!onchainSucceeded) {
        this.dataStorageMetrics.recordOnchainStatus(providerLabels, failureStatus);
      }

      if (retrievalStarted && !retrievalStatusEmitted) {
        this.retrievalMetrics.recordStatus(providerLabels, failureStatus);
        retrievalStatusEmitted = true;
      }
      if (!dataStorageStatusEmitted) {
        this.dataStorageMetrics.recordDataStorageStatus(providerLabels, failureStatus);
        dataStorageStatusEmitted = true;
      }

      throw error;
    } finally {
      if (!addonsAwaited && onStoredAddons.promise != null) {
        const pending = onStoredAddons.promise;
        addonAbortCtrl.abort();
        await pending.catch(() => {});
        if (deal.ipniStatus === IpniStatus.PENDING) {
          /** Addon aborted before reaching terminal IpniStatus. Clear so ClickHouse/Postgres analytics don't count a transient PENDING as a non-null outcome and depress IPNI success rates. Leaves real FAILED/VERIFIED untouched. See #503. */
          deal.ipniStatus = null;
        }
      }
      if (!preUploadTerminated) {
        await this.saveDeal(deal, retrievalResults, dealLogContext);
      }
    }
  }

  /**
   * Classifies a provider's dataset slot as `missing`, `live`, or `terminated`.
   * Resolves the dataset via createContext, then composes the liveness probes
   * documented on `isDataSetLive`.
   *
   * `terminated` means either FWSS or Curio reports the set as dead. See #379
   * and the SP-HTTP probe rationale in `isDataSetLive`.
   */
  async getDataSetProvisioningStatus(
    providerAddress: string,
    metadata: Record<string, string>,
    network: Network,
    signal?: AbortSignal,
  ): Promise<
    { status: "missing" } | { status: "live"; dataSetId: bigint } | { status: "terminated"; dataSetId: bigint }
  > {
    signal?.throwIfAborted();
    const synapse = this.walletSdkService.tryGetSynapse(network) ?? (await this.createSynapseInstance(network));
    const providerInfo = this.walletSdkService.getProviderInfo(providerAddress, network);
    if (!providerInfo) {
      throw new Error(`Provider ${providerAddress} not found in registry`);
    }
    const context = await awaitWithAbort(
      synapse.storage.createContext({
        providerId: providerInfo.id,
        metadata,
      }),
      signal,
    );
    signal?.throwIfAborted();
    if (context.dataSetId === undefined) {
      return { status: "missing" };
    }
    const dataSetId = context.dataSetId;
    const isLive = await this.isDataSetLive(providerAddress, dataSetId, network, signal);
    return isLive ? { status: "live", dataSetId } : { status: "terminated", dataSetId };
  }

  /**
   * Thin proxy to `DatasetLivenessService.isDataSetLive`. See that class for
   * probe rationale. Kept on DealService to preserve existing call sites
   * (`getDataSetProvisioningStatus`, `createDeal` post-context guard).
   */
  async isDataSetLive(
    providerAddress: string,
    dataSetId: bigint,
    network: Network,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return this.datasetLivenessService.isDataSetLive(providerAddress, dataSetId, network, signal);
  }

  /**
   * Repair a PDP-terminated dataset (FWSS may or may not have flipped pdpEndEpoch).
   *
   * Idempotent sequence:
   *   1. Read FWSS pdpEndEpoch. If already non-zero, skip termination.
   *   2. Otherwise call provider-relayed terminateService: the SDK signs the
   *      EIP-712 authorization and the provider relays the on-chain tx. The call
   *      resolves with the termination endEpoch once FWSS reports the service
   *      terminated. The SDK treats an already-terminated or in-flight service as
   *      a no-op, so a partially-completed prior run can complete.
   *   3. Mark every Deal row with this dataSetId as cleaned up in a single
   *      transaction (filtered on cleaned_up=false, so re-runs do not double-write).
   */
  async repairTerminatedDataSet(
    providerAddress: string,
    dataSetId: bigint,
    network: Network,
    signal?: AbortSignal,
  ): Promise<{ dealsAffected: number; pdpEndEpoch: bigint }> {
    signal?.throwIfAborted();
    const synapse = this.walletSdkService.tryGetSynapse(network) ?? (await this.createSynapseInstance(network));
    const providerInfo = this.walletSdkService.getProviderInfo(providerAddress, network);
    const { warmStorageService } = this.walletSdkService.getWalletServices(network);

    let pdpEndEpoch: bigint;
    const existing = await awaitWithAbort(warmStorageService.getDataSet({ dataSetId }), signal);
    if (existing != null && existing.pdpEndEpoch !== 0n) {
      pdpEndEpoch = existing.pdpEndEpoch;
      this.logger.log({
        event: "dataset_already_terminated",
        message: "FWSS pdpEndEpoch already set; skipping terminateService",
        providerAddress,
        dataSetId: dataSetId.toString(),
        pdpEndEpoch: pdpEndEpoch.toString(),
      });
    } else {
      signal?.throwIfAborted();
      const result = await awaitWithAbort(
        synapse.storage.terminateService({
          dataSetId,
          onSubmitted: (txHash) => {
            this.logger.log({
              event: "dataset_terminate_submitted",
              message: "Provider-relayed termination transaction submitted",
              providerAddress,
              dataSetId: dataSetId.toString(),
              txHash,
            });
          },
        }),
        signal,
      );
      pdpEndEpoch = result.endEpoch;
    }

    const result = await this.dealRepository.manager.transaction(async (manager) => {
      const update = await manager
        .getRepository(Deal)
        .update({ dataSetId, cleanedUp: false }, { cleanedUp: true, cleanedUpAt: new Date() });
      return update.affected ?? 0;
    });

    this.logger.log({
      event: "dataset_terminated_repaired",
      message: "Repaired PDP-terminated dataset",
      providerAddress,
      providerId: providerInfo?.id,
      dataSetId: dataSetId.toString(),
      pdpEndEpoch: pdpEndEpoch.toString(),
      dealsAffected: result,
    });

    return { dealsAffected: result, pdpEndEpoch };
  }

  /**
   * Creates an on-chain data-set with a minimal 200 KiB piece for a provider.
   * Uses createContext + executeUpload (same flow as data storage check) instead of
   * PDPServer.createDataSet, since empty datasets are being removed from curio and synapse-sdk.
   *
   * Goal: ensure the dataset is created and exists. No IPNI verification, retrieval checks,
   * or any post-upload steps. Skips Deal persistence and all data-storage-check metrics.
   */
  async createDataSetWithPiece(
    providerAddress: string,
    metadata: Record<string, string>,
    network: Network,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted();
    const providerInfo = this.walletSdkService.getProviderInfo(providerAddress, network);
    if (!providerInfo) {
      throw new Error(`Provider ${providerAddress} not found in registry`);
    }
    const labels = buildCheckMetricLabels({
      network,
      checkType: "dataSetCreation",
      providerId: providerInfo.id,
      providerName: providerInfo.name,
      providerIsApproved: providerInfo.isApproved,
    });

    const startedAt = Date.now();
    this.dataSetCreationMetrics.recordStatus(labels, "pending");
    this.logger.log({
      event: "dataset_creation_with_piece_started",
      message: "Starting data-set creation with piece",
      providerAddress,
      providerId: providerInfo.id,
      providerName: providerInfo.name,
      metadata,
    });

    let pieceAdded = false;
    let piecesConfirmed = false;
    let pieceCid: string | undefined;
    let pieceId: number | undefined;
    let transactionHash: string | undefined;

    try {
      const synapse = this.walletSdkService.tryGetSynapse(network) ?? (await this.createSynapseInstance(network));
      signal?.throwIfAborted();

      const DATA_SET_CREATION_PIECE_SIZE = 200 * 1024; // 200 KiB
      const payload = Buffer.alloc(DATA_SET_CREATION_PIECE_SIZE, 0x61);
      const dataFile = {
        data: payload,
        size: DATA_SET_CREATION_PIECE_SIZE,
        name: "dataset-seed.bin",
      };

      const carResult = await buildUnixfsCar(dataFile, { signal });
      signal?.throwIfAborted();

      const storage = await awaitWithAbort(
        synapse.storage.createContext({
          providerId: providerInfo.id,
          metadata,
        }),
        signal,
      );
      signal?.throwIfAborted();

      const filecoinPinLogger = createFilecoinPinLogger(this.logger);

      const uploadResult = (await awaitWithAbort(
        executeUpload(synapse, carResult.carData, carResult.rootCID, {
          logger: filecoinPinLogger,
          contextId: providerAddress,
          contexts: [storage],
          pieceMetadata: {},
          ipniValidation: { enabled: false },
          // Must stay synchronous — see issue #446.
          onProgress: (event) => {
            switch (event.type) {
              case "stored":
                pieceCid = event.data.pieceCid.toString();
                this.logger.debug({
                  event: "dataset_creation_stored",
                  message: "Data-set creation stored",
                  providerAddress,
                  providerId: providerInfo.id,
                  providerName: providerInfo.name,
                  pieceCid,
                });
                break;
              case "piecesAdded":
                pieceAdded = true;
                this.logger.debug({
                  event: "dataset_creation_pieces_added",
                  message: "Data-set creation pieces added",
                  providerAddress,
                  providerId: providerInfo.id,
                  providerName: providerInfo.name,
                  txHash: event.data.txHash ?? "unknown",
                });
                break;
              case "piecesConfirmed":
                piecesConfirmed = true;
                this.logger.debug({
                  event: "dataset_creation_pieces_confirmed",
                  message: "Data-set creation pieces confirmed",
                  providerAddress,
                  providerId: providerInfo.id,
                  providerName: providerInfo.name,
                  pieceIds: event.data.pieceIds,
                });
                break;
            }
          },
        }),
        signal,
      )) as Partial<UploadResultSummary> | undefined;

      pieceCid = pieceCid ?? uploadResult?.pieceCid;
      pieceId = uploadResult?.pieceId;
      transactionHash = uploadResult?.transactionHash;

      const durationMs = Date.now() - startedAt;
      this.dataSetCreationMetrics.observeCheckDuration(labels, durationMs);

      if (!pieceCid) {
        throw new Error("Data-set creation upload completed without producing a pieceCid");
      }

      this.dataSetCreationMetrics.recordStatus(labels, "success");

      if (!pieceAdded || !piecesConfirmed) {
        this.logger.warn({
          event: "dataset_creation_missing_onchain_events",
          message: "Data-set creation succeeded without full on-chain progress events",
          providerAddress,
          providerId: providerInfo.id,
          providerName: providerInfo.name,
          pieceAdded,
          piecesConfirmed,
        });
      }

      this.logger.log({
        event: "dataset_creation_with_piece_succeeded",
        message: "Data-set created with piece",
        providerAddress,
        providerId: providerInfo.id,
        providerName: providerInfo.name,
        durationMs,
        dataSetId: storage.dataSetId ?? "unknown",
        pieceCid: pieceCid ?? "unknown",
        pieceId: pieceId ?? "unknown",
        txHash: transactionHash ?? "unknown",
        pieceAdded,
        piecesConfirmed,
      });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      this.dataSetCreationMetrics.observeCheckDuration(labels, durationMs);
      this.dataSetCreationMetrics.recordStatus(labels, classifyFailureStatus(error));
      this.logger.error({
        event: "dataset_creation_with_piece_failed",
        message: "Data-set creation with piece failed",
        providerAddress,
        providerId: providerInfo.id,
        providerName: providerInfo.name,
        durationMs,
        pieceAdded,
        piecesConfirmed,
        pieceCid,
        pieceId,
        transactionHash,
        error: toStructuredError(error),
      });
      throw error;
    }
  }

  // ============================================================================
  // Deal Creation Helpers
  // ============================================================================

  private async createSynapseInstance(network: Network): Promise<Synapse> {
    try {
      const networkCfg = this.getNetworkConfig(network);
      const { synapse, isSessionKeyMode } = await createSynapseFromConfig(networkCfg);
      if (isSessionKeyMode) {
        this.logger.log({
          event: "synapse_session_key_init",
          message: "Initializing Synapse with session key",
          walletAddress: networkCfg.walletAddress,
        });
      }
      return synapse;
    } catch (error) {
      this.logger.error({
        event: "synapse_init_failed",
        message: "Failed to initialize Synapse for deal job",
        error: toStructuredError(error),
      });
      throw error;
    }
  }

  private async prepareUploadPayload(dealInput: DealPreprocessingResult, signal?: AbortSignal): Promise<UploadPayload> {
    const ipniMetadata = dealInput.metadata[ServiceType.IPFS_PIN];
    if (ipniMetadata?.rootCID) {
      return {
        carData: dealInput.processedData.data,
        rootCid: CID.parse(ipniMetadata.rootCID),
      };
    }

    const data = Buffer.isBuffer(dealInput.processedData.data)
      ? dealInput.processedData.data
      : Buffer.from(dealInput.processedData.data);

    signal?.throwIfAborted();
    const carResult = await buildUnixfsCar(
      {
        data,
        size: dealInput.processedData.size,
        name: dealInput.processedData.name,
      },
      {
        signal,
      },
    );

    return {
      carData: carResult.carData,
      rootCid: carResult.rootCID,
    };
  }

  private updateDealWithUploadResult(deal: Deal, uploadResult: UploadResultSummary, pieceSize: number): void {
    deal.pieceCid = uploadResult.pieceCid;
    // Only set pieceSize here if it hasn't been set earlier in the deal flow.
    deal.pieceSize = pieceSize;

    deal.pieceId = uploadResult.pieceId ?? deal.pieceId;
  }

  private async saveDeal(
    deal: Deal,
    retrievalResults: RetrievalExecutionResult[],
    dealLogContext: DealLogContext,
  ): Promise<void> {
    this.clickhouseService.insert("data_storage_checks", {
      timestamp: Date.now(),
      probe_location: this.clickhouseService.probeLocation,
      sp_address: deal.spAddress,
      sp_id: deal.storageProvider?.providerId != null ? String(deal.storageProvider.providerId) : null, // providerId is a BigInt
      sp_name: deal.storageProvider?.name ?? null,
      deal_id: deal.id,
      piece_cid: deal.pieceCid ?? null,
      piece_id: deal.pieceId ?? null,
      file_size_bytes: deal.fileSize ?? null,
      piece_size_bytes: deal.pieceSize ?? null,
      status: deal.status,
      error_code: deal.errorCode ?? null,
      upload_started_at: deal.uploadStartTime?.getTime() ?? null,
      upload_ended_at: deal.uploadEndTime?.getTime() ?? null,
      pieces_added_at: deal.piecesAddedTime?.getTime() ?? null,
      pieces_confirmed_at: deal.piecesConfirmedTime?.getTime() ?? null,
      ipni_status: deal.ipniStatus ?? null,
      ipni_indexed_at: deal.ipniIndexedAt?.getTime() ?? null,
      ipni_advertised_at: deal.ipniAdvertisedAt?.getTime() ?? null,
      ipni_verified_at: deal.ipniVerifiedAt?.getTime() ?? null,
      ipni_verified_cids_count: deal.ipniVerifiedCidsCount ?? null,
      ipni_unverified_cids_count: deal.ipniUnverifiedCidsCount ?? null,
      "retrieval_checks.method": retrievalResults.map((r) => r.method),
      "retrieval_checks.status": retrievalResults.map((r) => (r.success ? "success" : "failure")),
      "retrieval_checks.http_response_code": retrievalResults.map((r) => r.metrics.statusCode || null),
      "retrieval_checks.first_byte_ms": retrievalResults.map((r) => (r.success ? r.metrics.ttfb : null)),
      "retrieval_checks.last_byte_ms": retrievalResults.map((r) => (r.success ? r.metrics.latency : null)),
      "retrieval_checks.bytes_retrieved": retrievalResults.map((r) => (r.success ? r.metrics.responseSize : null)),
    });

    try {
      await this.dealRepository.save(deal);
    } catch (error) {
      this.logger.warn({
        ...dealLogContext,
        event: "save_deal_failed",
        message: "Failed to save deal",
        error: toStructuredError(error),
      });
    }
  }

  // ============================================================================
  // Data Source Management
  // ============================================================================

  private async fetchDataFile(minSize: number, maxSize: number): Promise<DataFile> {
    return await this.dataSourceService.generateRandomDataset(minSize, maxSize);
  }
}
