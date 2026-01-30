import { RPC_URLS, SIZE_CONSTANTS, Synapse } from "@filoz/synapse-sdk";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import { cleanupSynapseService, executeUpload } from "filecoin-pin";
import { CID } from "multiformats/cid";
import type { Counter, Histogram } from "prom-client";
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
    @InjectMetric("deals_created_total")
    private readonly dealsCreatedCounter: Counter,
    @InjectMetric("deal_creation_duration_seconds")
    private readonly dealCreationDuration: Histogram,
    @InjectMetric("deal_upload_duration_seconds")
    private readonly dealUploadDuration: Histogram,
    @InjectMetric("deal_chain_latency_seconds")
    private readonly dealChainLatency: Histogram,
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
    const { enableCDN, enableIpni } = this.getTestingDealOptions();

    this.logger.log(`Starting deal creation for ${totalProviders} providers (CDN: ${enableCDN}, IPNI: ${enableIpni})`);

    const { preprocessed, cleanup } = await this.prepareDealInput(enableCDN, enableIpni);

    try {
      const synapse = this.sharedSynapse ?? (await this.createSynapseInstance());
      const uploadPayload = await this.prepareUploadPayload(preprocessed);
      const providers = this.walletSdkService.getTestingProviders();

      const maxConcurrency = this.configService.get("scheduling").dealMaxConcurrency;
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
      enableCDN: boolean;
      enableIpni: boolean;
      existingDealId?: string;
    },
  ): Promise<Deal> {
    const { preprocessed, cleanup } = await this.prepareDealInput(options.enableCDN, options.enableIpni);

    try {
      const synapse = this.sharedSynapse ?? (await this.createSynapseInstance());
      const uploadPayload = await this.prepareUploadPayload(preprocessed);
      return await this.createDeal(synapse, providerInfo, preprocessed, uploadPayload, options.existingDealId);
    } finally {
      await cleanup();
    }
  }

  /**
   * Prepare a deal payload using the same data-source and preprocessing logic as normal deal creation.
   */
  async prepareDealInput(
    enableCDN: boolean,
    enableIpni: boolean,
  ): Promise<{ preprocessed: DealPreprocessingResult; cleanup: () => Promise<void> }> {
    const dataFile = await this.fetchDataFile(SIZE_CONSTANTS.MIN_UPLOAD_SIZE, SIZE_CONSTANTS.MAX_UPLOAD_SIZE);

    const preprocessed = await this.dealAddonsService.preprocessDeal({
      enableCDN,
      enableIpni,
      dataFile,
    });

    const cleanup = async () => this.dataSourceService.cleanupRandomDataset(dataFile.name);

    return { preprocessed, cleanup };
  }

  getTestingDealOptions(): { enableCDN: boolean; enableIpni: boolean } {
    const enableCDN = this.blockchainConfig.enableCDNTesting ? Math.random() > 0.5 : false;
    const enableIpni = this.getIpniEnabled(this.blockchainConfig.enableIpniTesting);

    return { enableCDN, enableIpni };
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
  ): Promise<Deal> {
    const providerAddress = providerInfo.serviceProvider;
    const providerShort = providerAddress.slice(0, 8);
    const dealStartTime = Date.now();

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

      const dataSetMetadata = { ...dealInput.synapseConfig.dataSetMetadata };

      if (this.blockchainConfig.dealbotDataSetVersion) {
        dataSetMetadata.dealbotDataSetVersion = this.blockchainConfig.dealbotDataSetVersion;
      }
      const filecoinPinLogger = createFilecoinPinLogger(this.logger);

      const storage = await synapse.storage.createContext({
        providerAddress,
        metadata: dataSetMetadata,
      });

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
            case "onUploadComplete":
              deal.uploadEndTime = new Date();
              deal.status = DealStatus.UPLOADED;
              deal.ingestLatencyMs = deal.uploadEndTime.getTime() - deal.uploadStartTime.getTime();
              deal.pieceCid = event.data.pieceCid.toString();
              this.logger.log(`Upload complete event, pieceCid: ${deal.pieceCid}`);
              onUploadCompleteAddonsPromise = this.dealAddonsService
                .handleUploadComplete(deal, dealInput.appliedAddons)
                .then(() => true)
                .catch((error) => {
                  uploadCompleteError = error;
                  return false;
                });
              deal.ingestThroughputBps = Math.round(
                deal.fileSize / ((deal.uploadEndTime.getTime() - deal.uploadStartTime.getTime()) / 1000),
              );
              break;
            case "onPieceAdded":
              this.logger.log(`Piece added event, txHash: ${event.data.txHash}`);
              deal.pieceAddedTime = new Date();
              if (event.data.txHash != null) {
                deal.transactionHash = event.data.txHash as Hex;
              } else {
                this.logger.warn(`No transaction hash found for piece added event: ${deal.pieceCid}`);
              }
              deal.status = DealStatus.PIECE_ADDED;
              break;
            case "onPieceConfirmed":
              this.logger.log(`Piece confirmed event, pieceIds: ${event.data.pieceIds.join(", ")}`);
              deal.pieceConfirmedTime = new Date();
              deal.status = DealStatus.PIECE_CONFIRMED;
              deal.chainLatencyMs = deal.pieceConfirmedTime.getTime() - deal.pieceAddedTime.getTime();
              break;
          }
        },
      });
      if (deal.pieceCid == null || deal.pieceAddedTime == null || deal.pieceConfirmedTime == null) {
        throw new Error("Dealbot did not receive onProgress events during upload");
      }

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
        // pieceUploadToRetrievableDuration
        deal.dealLatencyMs = deal.ipniVerifiedAt.getTime() - deal.uploadStartTime.getTime();
      }

      const retrievalConfig: RetrievalConfiguration = {
        deal,
        walletAddress: deal.walletAddress as Hex,
        storageProvider: deal.spAddress as Hex,
      };
      const retrievalStartTime = Date.now();
      const retrievalTest = await this.retrievalAddonsService.testAllRetrievalMethods(retrievalConfig);

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

      this.logger.log(`Deal ${deal.id} created: ${deal.pieceCid} (sp: ${providerAddress})`);

      await this.dealAddonsService.postProcessDeal(deal, dealInput.appliedAddons);

      // Record success metrics using short provider labels to limit cardinality.
      this.dealsCreatedCounter.inc({
        status: "success",
        provider: providerShort,
      });

      const dealDuration = (Date.now() - dealStartTime) / 1000;
      this.dealCreationDuration.observe(
        {
          provider: providerShort,
        },
        dealDuration,
      );

      // Record upload duration if available
      if (deal.ingestLatencyMs) {
        this.dealUploadDuration.observe(
          {
            provider: providerShort,
          },
          deal.ingestLatencyMs / 1000,
        );
      }

      // Record chain latency if available
      if (deal.chainLatencyMs) {
        this.dealChainLatency.observe(
          {
            provider: providerShort,
          },
          deal.chainLatencyMs / 1000,
        );
      }

      return deal;
    } catch (error) {
      this.logger.error(`Deal creation failed for ${providerShort}...: ${error.message}`);

      deal.status = DealStatus.FAILED;
      deal.errorMessage = error.message;

      // Record failure metrics
      this.dealsCreatedCounter.inc({
        status: "failed",
        provider: providerShort,
      });

      const dealDuration = (Date.now() - dealStartTime) / 1000;
      this.dealCreationDuration.observe(
        {
          provider: providerShort,
        },
        dealDuration,
      );

      throw error;
    } finally {
      await this.saveDeal(deal);
    }
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

  private async prepareUploadPayload(dealInput: DealPreprocessingResult): Promise<UploadPayload> {
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

    const carResult = await buildUnixfsCar({
      data,
      size: dealInput.processedData.size,
      name: dealInput.processedData.name,
    });

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
    try {
      return await this.dataSourceService.fetchKaggleDataset(minSize, maxSize);
    } catch (kaggleErr) {
      this.logger.warn("Failed to fetch Kaggle dataset, falling back to local dataset", kaggleErr);
      try {
        return await this.dataSourceService.fetchLocalDataset(minSize, maxSize);
      } catch (localErr) {
        this.logger.warn("Failed to fetch local dataset, generating random dataset", localErr);
        return await this.dataSourceService.generateRandomDataset(minSize, maxSize);
      }
    }
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
