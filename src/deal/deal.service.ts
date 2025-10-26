import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Deal } from "../database/entities/deal.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { DataSourceService } from "../dataSource/dataSource.service.js";
import { DealStatus } from "../database/entities/types.js";
import type { DataFile } from "../common/types.js";
import type { IBlockchainConfig, IConfig } from "../config/app.config.js";
import { type UploadResult, Synapse, RPC_URLS, SIZE_CONSTANTS, PieceCID, ProviderInfo } from "@filoz/synapse-sdk";
import type { Hex } from "../common/types.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { Repository } from "typeorm";
import { DealAddonsService } from "../deal-addons/deal-addons.service.js";
import type { DealPreprocessingResult } from "../deal-addons/types.js";

@Injectable()
export class DealService {
  private readonly logger = new Logger(DealService.name);
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
  ) {}

  async createDealsForAllProviders(): Promise<Deal[]> {
    const totalProviders = this.walletSdkService.getProviderCount();
    const enableCDN = Math.random() > 0.5;
    const enableIpni = Math.random() > 0.5;

    this.logger.log(`Starting deal creation for ${totalProviders} providers (CDN: ${enableCDN}, IPNI: ${enableIpni})`);

    const dataFile = await this.fetchDataFile(SIZE_CONSTANTS.MIN_UPLOAD_SIZE, SIZE_CONSTANTS.MAX_UPLOAD_SIZE);
    const preprocessed = await this.dealAddonsService.preprocessDeal({
      enableCDN,
      enableIpni,
      dataFile,
    });

    const results = await this.processProvidersInParallel(this.walletSdkService.approvedProviders, preprocessed);

    const successfulDeals = results.filter((result) => result.success).map((result) => result.deal!);
    const failedCount = results.filter((result) => !result.success).length;

    this.logger.log(`Deal creation completed: ${successfulDeals.length}/${totalProviders} successful`);

    return successfulDeals;
  }

  async createDeal(providerInfo: ProviderInfo, dealInput: DealPreprocessingResult): Promise<Deal> {
    const providerAddress = providerInfo.serviceProvider;
    const deal = this.dealRepository.create({
      fileName: dealInput.processedData.name,
      fileSize: dealInput.processedData.size,
      spAddress: providerAddress,
      status: DealStatus.PENDING,
      walletAddress: this.configService.get("blockchain").walletAddress,
      metadata: dealInput.metadata,
    });

    try {
      const provider = await this.trackStorageProvider(providerInfo);

      const synapse = await this.getStorageService();
      const storage = await synapse.createStorage({
        providerAddress,
        ...dealInput.synapseConfig,
      });

      deal.dataSetId = storage.dataSetId;
      deal.uploadStartTime = new Date();

      const uploadResult: UploadResult = await storage.upload(dealInput.processedData.data, {
        onUploadComplete: (pieceCid) => this.handleUploadComplete(deal, pieceCid),
        onPieceAdded: (result) => this.handleRootAdded(deal, result?.hash),
      });

      this.updateDealWithUploadResult(deal, uploadResult);

      this.logger.log(
        `Deal created: ${uploadResult.pieceCid.toString().slice(0, 12)}... (${providerAddress.slice(0, 8)}...)`,
      );

      // Load storageProvider relation before post-processing
      deal.storageProvider = provider;
      await this.dealAddonsService.postProcessDeal(deal, dealInput.appliedAddons);

      return deal;
    } catch (error) {
      this.logger.error(`Deal creation failed for ${providerAddress.slice(0, 8)}...: ${error.message}`);

      deal.status = DealStatus.FAILED;
      deal.errorMessage = error.message;

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

  private async getStorageService(): Promise<Synapse> {
    if (!this.synapse) {
      const blockchainConfig = this.configService.get<IBlockchainConfig>("blockchain");
      this.synapse = await Synapse.create({
        privateKey: blockchainConfig.walletPrivateKey,
        rpcURL: RPC_URLS[blockchainConfig.network].http,
      });
    }
    return this.synapse;
  }

  // ============================================================================
  // Parallel Processing
  // ============================================================================

  private async processProvidersInParallel(
    providers: ProviderInfo[],
    dealInput: DealPreprocessingResult,
    maxConcurrency: number = 20,
  ): Promise<Array<{ success: boolean; deal?: Deal; error?: string; provider: string }>> {
    const results: Array<{ success: boolean; deal?: Deal; error?: string; provider: string }> = [];

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

  private async handleUploadComplete(deal: Deal, pieceCid: PieceCID): Promise<void> {
    deal.pieceCid = pieceCid.toString();
    deal.uploadEndTime = new Date();
    deal.ingestLatencyMs = deal.uploadEndTime.getTime() - deal.uploadStartTime.getTime();
    deal.ingestThroughputBps = Math.round(
      deal.fileSize / ((deal.uploadEndTime.getTime() - deal.uploadStartTime.getTime()) / 1000),
    );
    deal.status = DealStatus.UPLOADED;
  }

  private async handleRootAdded(deal: Deal, result: any): Promise<void> {
    deal.pieceAddedTime = new Date();
    deal.chainLatencyMs = deal.pieceAddedTime.getTime() - deal.uploadEndTime.getTime();
    deal.status = DealStatus.PIECE_ADDED;
    deal.transactionHash = result.transactionHash;
  }

  // ============================================================================
  // Storage Provider Management
  // ============================================================================

  private async trackStorageProvider(providerInfo: ProviderInfo): Promise<StorageProvider> {
    const providerAddress = providerInfo.serviceProvider;
    try {
      let provider = await this.storageProviderRepository.findOne({ where: { address: providerAddress } });

      if (!provider) {
        provider = this.storageProviderRepository.create({
          address: providerAddress as Hex,
          name: providerInfo.name,
          description: providerInfo.description,
          payee: providerInfo.payee,
          serviceUrl: providerInfo.products.PDP?.data.serviceURL,
          isActive: providerInfo.active,
          region: providerInfo.products.PDP?.data.location,
          metadata: providerInfo.products.PDP?.capabilities,
        });

        provider = await this.storageProviderRepository.save(provider);
      }

      return provider;
    } catch (error) {
      this.logger.warn(`Failed to track provider ${providerAddress.slice(0, 8)}...: ${error.message}`);
      throw error;
    }
  }

  // ============================================================================
  // Data Source Management
  // ============================================================================

  private async fetchDataFile(minSize: number, maxSize: number): Promise<DataFile> {
    try {
      return await this.dataSourceService.fetchKaggleDataset(minSize, maxSize);
    } catch (err) {
      return await this.dataSourceService.fetchLocalDataset(minSize, maxSize);
    }
  }
}
