import { type PieceCID, SIZE_CONSTANTS, Synapse, type UploadResult } from "@filoz/synapse-sdk";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import type { Counter, Histogram } from "prom-client";
import type { Repository } from "typeorm";
import type { DataFile } from "../common/types.js";
import type { IBlockchainConfig, IConfig } from "../config/app.config.js";
import { Deal } from "../database/entities/deal.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { DealStatus, type ServiceType } from "../database/types.js";
import { DataSourceService } from "../dataSource/dataSource.service.js";
import { DealAddonsService } from "../deal-addons/deal-addons.service.js";
import type { DealPreprocessingResult } from "../deal-addons/types.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import type { ProviderInfoEx } from "../wallet-sdk/wallet-sdk.types.js";
import { privateKeyToAccount } from "viem/accounts";

@Injectable()
export class DealService implements OnModuleInit {
  private readonly logger = new Logger(DealService.name);
  private readonly blockchainConfig: IBlockchainConfig;
  private synapse: Synapse;

  constructor(
    private readonly dataSourceService: DataSourceService,
    private readonly configService: ConfigService<IConfig, true>,
    private readonly walletSdkService: WalletSdkService,
    private readonly dealAddonsService: DealAddonsService,
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

  async onModuleInit() {
    try {
      this.synapse = await Synapse.create({
        account: privateKeyToAccount(this.blockchainConfig.walletPrivateKey),
        warmStorageAddress: this.walletSdkService.getFWSSAddress(),
      });
    } catch (error) {
      this.logger.error(`Failed to initialize DealService: ${error.message}`, error.stack);
      throw error;
    }
  }

  async createDealsForAllProviders(): Promise<Deal[]> {
    const totalProviders = this.walletSdkService.getTestingProvidersCount();
    const { enableCDN, enableIpni } = this.getTestingDealOptions();

    this.logger.log(`Starting deal creation for ${totalProviders} providers (CDN: ${enableCDN}, IPNI: ${enableIpni})`);

    const { preprocessed, cleanup } = await this.prepareDealInput(enableCDN, enableIpni);

    try {
      const providers = this.walletSdkService.getTestingProviders();

      const results = await this.processProvidersInParallel(providers, preprocessed);

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
      return await this.createDeal(providerInfo, preprocessed, options.existingDealId);
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
  ): Promise<{
    preprocessed: DealPreprocessingResult;
    cleanup: () => Promise<void>;
  }> {
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
    providerInfo: ProviderInfoEx,
    dealInput: DealPreprocessingResult,
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

      const storage = await this.synapse.createStorage({
        providerAddress,
        metadata: dataSetMetadata,
      });

      deal.dataSetId = storage.dataSetId;
      deal.uploadStartTime = new Date();

      let callbackError: Error | null = null;
      const pendingCallbacks: Promise<void>[] = [];

      const safeOnUploadComplete = (pieceCid: PieceCID) => {
        const promise = this.handleUploadComplete(deal, pieceCid, dealInput.appliedAddons).catch((error) => {
          const err = error instanceof Error ? error : new Error(String(error));
          this.logger.warn(`Upload completion handler failed for ${providerShort}...: ${err.message}`);
          callbackError = err;
        });
        pendingCallbacks.push(promise);
      };

      const safeOnPieceAdded = (hash: Parameters<DealService["handleRootAdded"]>[1]) => {
        const promise = this.handleRootAdded(deal, hash).catch((error) => {
          const err = error instanceof Error ? error : new Error(String(error));
          this.logger.warn(`Piece added handler failed for ${providerShort}...: ${err.message}`);
          callbackError = err;
        });
        pendingCallbacks.push(promise);
      };

      const uploadResult: UploadResult = await storage.upload(dealInput.processedData.data, {
        onUploadComplete: safeOnUploadComplete,
        onPieceAdded: safeOnPieceAdded,
        metadata: dealInput.synapseConfig.pieceMetadata,
      });

      // Wait for any floating callbacks to finish before proceeding
      await Promise.all(pendingCallbacks);

      // If any callback failed, throw the error to trigger the main catch block
      // This ensures the deal is marked as FAILED if callbacks (like IPNI updates) fail
      if (callbackError) {
        throw callbackError;
      }

      this.updateDealWithUploadResult(deal, uploadResult);

      this.logger.log(`Deal created: ${uploadResult.pieceCid.toString().slice(0, 12)}... (${providerShort}...)`);

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

  private updateDealWithUploadResult(deal: Deal, uploadResult: UploadResult): void {
    deal.pieceCid = uploadResult.pieceCid.toString();
    deal.pieceSize = uploadResult.size;
    deal.pieceId = uploadResult.pieceId;
    deal.status = DealStatus.DEAL_CREATED;
    deal.dealConfirmedTime = new Date();
    deal.dealLatencyMs = deal.dealConfirmedTime.getTime() - deal.uploadStartTime.getTime();
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
    providers: ProviderInfoEx[],
    dealInput: DealPreprocessingResult,
    maxConcurrency: number = 10,
  ): Promise<Array<{ success: boolean; deal?: Deal; error?: string; provider: string }>> {
    const results: Array<{
      success: boolean;
      deal?: Deal;
      error?: string;
      provider: string;
    }> = [];

    for (let i = 0; i < providers.length; i += maxConcurrency) {
      const batch = providers.slice(i, i + maxConcurrency);
      const batchPromises = batch.map((provider) => this.createDeal(provider, dealInput));
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
  // Upload Lifecycle Handlers
  // ============================================================================

  private async handleUploadComplete(deal: Deal, pieceCid: PieceCID, appliedAddons: ServiceType[]): Promise<void> {
    deal.pieceCid = pieceCid.toString();
    deal.uploadEndTime = new Date();
    deal.ingestLatencyMs = deal.uploadEndTime.getTime() - deal.uploadStartTime.getTime();
    deal.ingestThroughputBps = Math.round(
      deal.fileSize / ((deal.uploadEndTime.getTime() - deal.uploadStartTime.getTime()) / 1000),
    );
    deal.status = DealStatus.UPLOADED;

    // Trigger addon onUploadComplete handlers
    await this.dealAddonsService.handleUploadComplete(deal, appliedAddons);
  }

  private async handleRootAdded(deal: Deal, result: any): Promise<void> {
    deal.pieceAddedTime = new Date();
    deal.chainLatencyMs = deal.pieceAddedTime.getTime() - deal.uploadEndTime.getTime();
    deal.status = DealStatus.PIECE_ADDED;
    deal.transactionHash = result.transactionHash;
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
