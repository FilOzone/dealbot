import { randomBytes } from "node:crypto";
import { PDPAuthHelper, PDPServer, RPC_URLS, SIZE_CONSTANTS, Synapse } from "@filoz/synapse-sdk";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { cleanupSynapseService, executeUpload } from "filecoin-pin";
import { CID } from "multiformats/cid";
import type { Repository } from "typeorm";
import { buildUnixfsCar } from "../common/car-utils.js";
import { createFilecoinPinLogger } from "../common/filecoin-pin-logger.js";
import type { DataFile, Hex } from "../common/types.js";
import type { IBlockchainConfig, IConfig } from "../config/app.config.js";
import { Deal } from "../database/entities/deal.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { DealStatus, ServiceType } from "../database/types.js";
import { DataSourceService } from "../dataSource/dataSource.service.js";
import { DealAddonsService } from "../deal-addons/deal-addons.service.js";
import type { DealPreprocessingResult } from "../deal-addons/types.js";
import { buildCheckMetricLabels, classifyFailureStatus } from "../metrics/utils/check-metric-labels.js";
import { DataStorageCheckMetrics, RetrievalCheckMetrics } from "../metrics/utils/check-metrics.service.js";
import { RetrievalAddonsService } from "../retrieval-addons/retrieval-addons.service.js";
import type { RetrievalConfiguration } from "../retrieval-addons/types.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import type { ProviderInfoEx } from "../wallet-sdk/wallet-sdk.types.js";

type UploadPayload = {
  carData: Uint8Array;
  rootCid: CID;
};

type UploadResultSummary = {
  pieceCid: string;
  pieceId?: number;
  transactionHash?: string;
};

type SynapseServiceArg = Parameters<typeof executeUpload>[0];

@Injectable()
export class DealService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DealService.name);
  private readonly blockchainConfig: IBlockchainConfig;
  private sharedSynapse?: Synapse;

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
  ) {
    this.blockchainConfig = this.configService.get("blockchain");
  }

  async onModuleInit(): Promise<void> {
    this.logger.log("Initializing shared Synapse instance for deal creation.");
    this.sharedSynapse = await this.createSynapseInstance();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.sharedSynapse) {
      await this.cleanupSynapseInstance(this.sharedSynapse);
      this.sharedSynapse = undefined;
    }
  }

  async createDealsForAllProviders(): Promise<Deal[]> {
    const totalProviders = this.walletSdkService.getTestingProvidersCount();
    const { enableIpni } = this.getTestingDealOptions();

    this.logger.log(`Starting deal creation for ${totalProviders} providers`);

    const { preprocessed, cleanup } = await this.prepareDealInput(enableIpni);

    try {
      const synapse = this.sharedSynapse ?? (await this.createSynapseInstance());
      const uploadPayload = await this.prepareUploadPayload(preprocessed);
      const providers = this.walletSdkService.getTestingProviders();

      // Legacy cron-only path: keep fixed concurrency until cron mode is removed.
      const maxConcurrency = 10;
      const results = await this.processProvidersInParallel(
        synapse,
        providers,
        preprocessed,
        uploadPayload,
        maxConcurrency,
      );

      const successfulDeals = results.filter((result) => result.success).map((result) => result.deal!);

      this.logger.log(`Deal creation completed: ${successfulDeals.length}/${totalProviders} successful`);

      return successfulDeals;
    } finally {
      // Cleanup random dataset file after all uploads complete (success or failure)
      await cleanup();
    }
  }

  async createDealForProvider(
    providerInfo: ProviderInfoEx,
    options: {
      enableIpni: boolean;
      existingDealId?: string;
      signal?: AbortSignal;
      extraDataSetMetadata?: Record<string, string>;
    },
  ): Promise<Deal> {
    const { preprocessed, cleanup } = await this.prepareDealInput(options.enableIpni, options.signal);

    try {
      const synapse = this.sharedSynapse ?? (await this.createSynapseInstance());
      const uploadPayload = await this.prepareUploadPayload(preprocessed, options.signal);
      return await this.createDeal(
        synapse,
        providerInfo,
        preprocessed,
        uploadPayload,
        options.existingDealId,
        options.signal,
        options.extraDataSetMetadata,
      );
    } finally {
      await cleanup();
    }
  }

  /**
   * Prepare a deal payload using the same data-source and preprocessing logic as normal deal creation.
   */
  async prepareDealInput(
    enableIpni: boolean,
    signal?: AbortSignal,
  ): Promise<{ preprocessed: DealPreprocessingResult; cleanup: () => Promise<void> }> {
    const dataFile = await this.fetchDataFile(SIZE_CONSTANTS.MIN_UPLOAD_SIZE, SIZE_CONSTANTS.MAX_UPLOAD_SIZE);

    const preprocessed = await this.dealAddonsService.preprocessDeal(
      {
        enableIpni,
        dataFile,
      },
      signal,
    );

    const cleanup = async () => this.dataSourceService.cleanupRandomDataset(dataFile.name);

    return { preprocessed, cleanup };
  }

  getTestingDealOptions(): { enableIpni: boolean } {
    const enableIpni = this.getIpniEnabled(this.blockchainConfig.enableIpniTesting);

    return { enableIpni };
  }

  getWalletAddress(): string {
    return this.blockchainConfig.walletAddress;
  }

  async createDeal(
    synapse: Synapse,
    providerInfo: ProviderInfoEx,
    dealInput: DealPreprocessingResult,
    uploadPayload: UploadPayload,
    existingDealId?: string,
    signal?: AbortSignal,
    extraDataSetMetadata?: Record<string, string>,
  ): Promise<Deal> {
    const providerAddress = providerInfo.serviceProvider;
    const checkType = "dataStorage" as const;
    let providerLabels = buildCheckMetricLabels({
      checkType,
      providerId: undefined,
      providerIsApproved: providerInfo.isApproved,
    });
    let uploadSucceeded = false;
    let onchainSucceeded = false;
    let retrievalStarted = false;
    let retrievalStatusEmitted = false;

    let deal: Deal;
    if (existingDealId) {
      const existingDeal = await this.dealRepository.findOne({
        where: { id: existingDealId },
      });
      if (!existingDeal) {
        throw new Error(`Deal not found: ${existingDealId}`);
      }
      deal = existingDeal;
    } else {
      deal = this.dealRepository.create();
    }

    deal.fileName = dealInput.processedData.name;
    deal.fileSize = dealInput.processedData.size;
    deal.spAddress = providerAddress;
    deal.status = DealStatus.PENDING;
    deal.walletAddress = this.blockchainConfig.walletAddress;
    deal.metadata = dealInput.metadata;
    deal.serviceTypes = dealInput.appliedAddons;

    try {
      // Load storageProvider relation
      deal.storageProvider = await this.storageProviderRepository.findOne({
        where: { address: deal.spAddress },
      });
      providerLabels = buildCheckMetricLabels({
        checkType,
        providerId: deal.storageProvider?.providerId,
        providerIsApproved: providerInfo.isApproved ?? deal.storageProvider?.isApproved,
      });
      this.dataStorageMetrics.recordUploadStatus(providerLabels, "pending");
      this.dataStorageMetrics.recordDataStorageStatus(providerLabels, "pending");

      const dataSetMetadata = { ...dealInput.synapseConfig.dataSetMetadata, ...extraDataSetMetadata };

      if (this.blockchainConfig.dealbotDataSetVersion) {
        dataSetMetadata.dealbotDataSetVersion = this.blockchainConfig.dealbotDataSetVersion;
      }
      const filecoinPinLogger = createFilecoinPinLogger(this.logger);

      signal?.throwIfAborted();

      const storage = await synapse.storage.createContext({
        providerAddress,
        metadata: dataSetMetadata,
      });
      signal?.throwIfAborted();

      deal.dataSetId = storage.dataSetId;
      deal.uploadStartTime = new Date();
      let onUploadCompleteAddonsPromise: Promise<boolean> | null = null;
      let uploadCompleteError: Error | undefined;

      const synapseService = { synapse, storage, providerInfo } as unknown as SynapseServiceArg;
      const uploadResult = await executeUpload(synapseService, uploadPayload.carData, uploadPayload.rootCid, {
        logger: filecoinPinLogger,
        contextId: providerAddress,
        pieceMetadata: dealInput.synapseConfig.pieceMetadata,
        /**
         * do not do IPNI validation here, we need to call /pdp/piece/<pieceCid>/status to get other metrics.
         * See `onUploadComplete` handler in deal-addons/strategies/ipni.strategy.ts for implementation.
         */
        ipniValidation: { enabled: false },
        onProgress: async (event) => {
          this.logger.debug(`Upload progress event: ${event.type}`);
          switch (event.type) {
            case "onUploadComplete": {
              deal.uploadEndTime = new Date();
              deal.status = DealStatus.UPLOADED;
              deal.ingestLatencyMs = deal.uploadEndTime.getTime() - deal.uploadStartTime.getTime();
              deal.pieceCid = event.data.pieceCid.toString();
              this.logger.log(`Upload complete event, pieceCid: ${deal.pieceCid}`);
              uploadSucceeded = true;
              this.dataStorageMetrics.observeIngestMs(providerLabels, deal.ingestLatencyMs);
              this.dataStorageMetrics.recordUploadStatus(providerLabels, "success");
              this.dataStorageMetrics.recordOnchainStatus(providerLabels, "pending");
              onUploadCompleteAddonsPromise = this.dealAddonsService
                .handleUploadComplete(deal, dealInput.appliedAddons, signal)
                .then(() => true)
                .catch((error) => {
                  uploadCompleteError = error;
                  return false;
                });
              const ingestSeconds = deal.ingestLatencyMs / 1000;
              if (ingestSeconds > 0 && Number.isFinite(ingestSeconds)) {
                deal.ingestThroughputBps = Math.round(deal.fileSize / ingestSeconds);
                this.dataStorageMetrics.observeIngestThroughput(providerLabels, deal.ingestThroughputBps);
              } else {
                deal.ingestThroughputBps = 0;
                this.logger.warn(
                  `Skipping ingest throughput: invalid ingest latency (${deal.ingestLatencyMs}ms) for deal ${deal.id}`,
                );
              }
              break;
            }
            case "onPieceAdded":
              this.logger.log(`Piece added event, txHash: ${event.data.txHash}`);
              deal.pieceAddedTime = new Date();
              if (event.data.txHash != null) {
                deal.transactionHash = event.data.txHash as Hex;
              } else {
                this.logger.warn(`No transaction hash found for piece added event: ${deal.pieceCid}`);
              }
              deal.status = DealStatus.PIECE_ADDED;
              this.dataStorageMetrics.observePieceAddedOnChainMs(
                providerLabels,
                deal.pieceAddedTime.getTime() - deal.uploadEndTime.getTime(),
              );
              break;
            case "onPieceConfirmed":
              this.logger.log(`Piece confirmed event, pieceIds: ${event.data.pieceIds.join(", ")}`);
              deal.pieceConfirmedTime = new Date();
              deal.status = DealStatus.PIECE_CONFIRMED;
              deal.chainLatencyMs = deal.pieceConfirmedTime.getTime() - deal.pieceAddedTime.getTime();
              onchainSucceeded = true;
              this.dataStorageMetrics.observePieceConfirmedOnChainMs(providerLabels, deal.chainLatencyMs);
              this.dataStorageMetrics.recordOnchainStatus(providerLabels, "success");
              break;
          }
          // throw if aborted, AFTER adding data to the `deal` object. Everything in this `onProgress` callback is synchronous.
          signal?.throwIfAborted();
        },
      });
      signal?.throwIfAborted();
      if (deal.pieceCid == null || deal.pieceAddedTime == null || deal.pieceConfirmedTime == null) {
        throw new Error("Dealbot did not receive onProgress events during upload");
      }

      deal.dealLatencyMs = deal.pieceConfirmedTime.getTime() - deal.uploadStartTime.getTime();

      if (!deal.transactionHash && uploadResult.transactionHash) {
        deal.transactionHash = uploadResult.transactionHash as Hex;
      }

      if (!deal.transactionHash) {
        this.logger.error(`No transaction hash found for deal: ${deal.pieceCid}`);
      }

      this.updateDealWithUploadResult(deal, uploadResult, uploadPayload.carData.length);

      // wait for onUploadComplete handlers to complete
      if (onUploadCompleteAddonsPromise != null) {
        const uploadCompleteOk = await onUploadCompleteAddonsPromise;
        onUploadCompleteAddonsPromise = null;
        if (!uploadCompleteOk) {
          throw uploadCompleteError ?? new Error("Upload completion handlers failed");
        }
        deal.dealConfirmedTime = new Date();
        if (deal.ipniVerifiedAt) {
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
      const retrievalTest = await this.retrievalAddonsService.testAllRetrievalMethods(retrievalConfig, signal);
      signal?.throwIfAborted();

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
        // dataStorageCheckDuration = retrievalTest.testedAt - deal.uploadEndTime
        // retrievals were successful.. lets log some stats
        this.logger.log(
          `Retrieval test completed in ${retrievalTest.testedAt.getTime() - retrievalStartTime}ms: ` +
            `${retrievalTest.summary.successfulMethods}/${retrievalTest.summary.totalMethods} successful`,
        );
      }

      deal.status = DealStatus.DEAL_CREATED;
      if (deal.uploadStartTime) {
        const checkDurationMs = Date.now() - deal.uploadStartTime.getTime();
        this.dataStorageMetrics.observeCheckDuration(providerLabels, checkDurationMs);
      }
      this.dataStorageMetrics.recordDataStorageStatus(providerLabels, "success");

      this.logger.log(`Deal ${deal.id} created: ${deal.pieceCid} (sp: ${providerAddress})`);

      await this.dealAddonsService.postProcessDeal(deal, dealInput.appliedAddons);

      return deal;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Deal creation failed for ${providerAddress}: ${errorMessage}`);
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
      this.dataStorageMetrics.recordDataStorageStatus(providerLabels, failureStatus);

      throw error;
    } finally {
      await this.saveDeal(deal);
    }
  }

  /**
   * Checks if an on-chain data set exists for a provider with specific metadata.
   */
  async checkDataSetExists(providerAddress: string, metadata: Record<string, string>): Promise<boolean> {
    const synapse = this.sharedSynapse ?? (await this.createSynapseInstance());
    const context = await synapse.storage.createContext({
      providerAddress,
      metadata,
    });
    return context.dataSetId !== undefined;
  }

  /**
   * Creates an on-chain data-set for a provider with the given metadata.
   *
   * Uses PDPServer.createDataSet() which sends an EIP-712 signed transaction
   * to the PDP service, creating the data-set on-chain and polling for
   * confirmation.
   *
   * @returns The confirmed on-chain data-set ID.
   */
  async createDataSet(providerAddress: string, metadata: Record<string, string>): Promise<{ dataSetId: number }> {
    const synapse = this.sharedSynapse ?? (await this.createSynapseInstance());
    const provider = this.walletSdkService.getProviderInfo(providerAddress);
    if (!provider) {
      throw new Error(`Provider ${providerAddress} not found in registry`);
    }

    const serviceURL = provider.products.PDP?.data.serviceURL;
    if (!serviceURL) {
      throw new Error(`Provider ${providerAddress} has no PDP serviceURL`);
    }

    const signer = synapse.getSigner();
    const warmStorageAddress = synapse.getWarmStorageAddress();
    const chainId = synapse.getChainId();
    const authHelper = new PDPAuthHelper(warmStorageAddress, signer, BigInt(chainId));
    const pdpServer = new PDPServer(authHelper, serviceURL);

    const metadataEntries = Object.entries(metadata).map(([key, value]) => ({ key, value }));

    const payer = await synapse.getClient().getAddress();
    const clientDataSetId = BigInt(`0x${randomBytes(32).toString("hex")}`);

    const result = await pdpServer.createDataSet(
      clientDataSetId,
      provider.payee,
      payer,
      metadataEntries,
      warmStorageAddress,
    );

    this.logger.log(`Data-set creation tx submitted: ${result.txHash} for provider ${providerAddress}`);

    // Poll for on-chain confirmation
    const confirmed = await this.pollForDataSetCreation(pdpServer, result.txHash);

    this.logger.log(`Data-set created on-chain: ID=${confirmed.dataSetId} for provider ${providerAddress}`);

    return { dataSetId: confirmed.dataSetId! };
  }

  /**
   * Polls the PDP server until the data-set creation transaction is confirmed on-chain.
   */
  private async pollForDataSetCreation(
    pdpServer: PDPServer,
    txHash: string,
    maxAttempts = 60,
    intervalMs = 5000,
  ): Promise<{ dataSetId?: number }> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const status = await pdpServer.getDataSetCreationStatus(txHash);
      if (status.dataSetCreated && status.dataSetId != null) {
        return { dataSetId: status.dataSetId };
      }
      if (status.ok === false) {
        throw new Error(`Data-set creation tx failed: ${txHash}`);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`Data-set creation timed out after ${(maxAttempts * intervalMs) / 1000}s for tx: ${txHash}`);
  }

  // ============================================================================
  // Deal Creation Helpers
  // ============================================================================

  private async createSynapseInstance(): Promise<Synapse> {
    try {
      return await Synapse.create({
        privateKey: this.blockchainConfig.walletPrivateKey,
        rpcURL: RPC_URLS[this.blockchainConfig.network].http,
        warmStorageAddress: this.walletSdkService.getFWSSAddress(),
      });
    } catch (error) {
      this.logger.error(`Failed to initialize Synapse for deal job: ${error.message}`, error.stack);
      throw error;
    }
  }

  private async cleanupSynapseInstance(synapse: Synapse): Promise<void> {
    try {
      await synapse.telemetry?.sentry?.close?.();
    } catch (error) {
      this.logger.warn(`Failed to cleanup Synapse telemetry: ${error.message}`);
    }
    try {
      await cleanupSynapseService();
    } catch (error) {
      this.logger.warn(`Failed to cleanup Synapse service: ${error.message}`);
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

    deal.pieceId = uploadResult.pieceId;
  }

  private async saveDeal(deal: Deal): Promise<void> {
    try {
      await this.dealRepository.save(deal);
    } catch (error) {
      this.logger.warn(`Failed to save deal ${deal.pieceCid}: ${error.message}`);
    }
  }

  // ============================================================================
  // Parallel Processing
  // ============================================================================

  private async processProvidersInParallel(
    synapse: Synapse,
    providers: ProviderInfoEx[],
    dealInput: DealPreprocessingResult,
    uploadPayload: UploadPayload,
    maxConcurrency: number,
  ): Promise<Array<{ success: boolean; deal?: Deal; error?: string; provider: string }>> {
    const results: Array<{
      success: boolean;
      deal?: Deal;
      error?: string;
      provider: string;
    }> = [];

    for (let i = 0; i < providers.length; i += maxConcurrency) {
      const batch = providers.slice(i, i + maxConcurrency);
      const batchPromises = batch.map((provider) => this.createDeal(synapse, provider, dealInput, uploadPayload));
      const batchResults = await Promise.allSettled(batchPromises);

      batchResults.forEach((result, index) => {
        const provider = batch[index];

        if (result.status === "fulfilled") {
          results.push({
            success: true,
            deal: result.value,
            provider: provider.serviceProvider,
          });
        } else {
          results.push({
            success: false,
            error: result.reason?.message || "Unknown error",
            provider: provider.serviceProvider,
          });
        }
      });
    }

    return results;
  }

  // ============================================================================
  // Data Source Management
  // ============================================================================

  private async fetchDataFile(minSize: number, maxSize: number): Promise<DataFile> {
    return await this.dataSourceService.generateRandomDataset(minSize, maxSize);
  }

  private getIpniEnabled(mode: IBlockchainConfig["enableIpniTesting"]): boolean {
    switch (mode) {
      case "disabled":
        return false;
      case "random":
        return Math.random() > 0.5;
      default:
        return true;
    }
  }
}
