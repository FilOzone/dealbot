import { type PieceCID, RPC_URLS, SIZE_CONSTANTS, Synapse, type UploadResult } from "@filoz/synapse-sdk";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import type { DataFile } from "../common/types.js";
import type { IBlockchainConfig, IConfig } from "../config/app.config.js";
import { Deal } from "../database/entities/deal.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { DealStatus, ServiceType } from "../database/types.js";
import { DataSourceService } from "../dataSource/dataSource.service.js";
import { DealAddonsService } from "../deal-addons/deal-addons.service.js";
import type { DealPreprocessingResult } from "../deal-addons/types.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { ProviderInfoEx } from "../wallet-sdk/wallet-sdk.types.js";

@Injectable()
export class DealService {
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
  ) {
    this.blockchainConfig = this.configService.get("blockchain");
  }

  async createDealsForAllProviders(): Promise<Deal[]> {
    const totalProviders = this.walletSdkService.getTestingProvidersCount();
    const enableCDN = this.blockchainConfig.enableCDNTesting ? Math.random() > 0.5 : false;
    const enableIpni = this.blockchainConfig.enableIpniTesting ? Math.random() > 0.5 : false;

    this.logger.log(`Starting deal creation for ${totalProviders} providers (CDN: ${enableCDN}, IPNI: ${enableIpni})`);

    const dataFile = await this.fetchDataFile(SIZE_CONSTANTS.MIN_UPLOAD_SIZE, SIZE_CONSTANTS.MAX_UPLOAD_SIZE);
    const preprocessed = await this.dealAddonsService.preprocessDeal({
      enableCDN,
      enableIpni,
      dataFile,
    });

    const providers = this.walletSdkService.getTestingProviders();

    const results = await this.processProvidersInParallel(providers, preprocessed);

    const successfulDeals = results.filter((result) => result.success).map((result) => result.deal!);

    this.logger.log(`Deal creation completed: ${successfulDeals.length}/${totalProviders} successful`);

    return successfulDeals;
  }

  async createDeal(providerInfo: ProviderInfoEx, dealInput: DealPreprocessingResult): Promise<Deal> {
    const providerAddress = providerInfo.serviceProvider;
    const deal = this.dealRepository.create({
      fileName: dealInput.processedData.name,
      fileSize: dealInput.processedData.size,
      spAddress: providerAddress,
      status: DealStatus.PENDING,
      walletAddress: this.blockchainConfig.walletAddress,
      metadata: dealInput.metadata,
      serviceTypes: dealInput.appliedAddons,
    });

    try {
      // Load storageProvider relation
      deal.storageProvider = await this.storageProviderRepository.findOne({
        where: { address: deal.spAddress },
      });

      const synapse = await this.getStorageService();
      const storage = await synapse.createStorage({
        providerAddress,
        ...dealInput.synapseConfig,
      });

      deal.dataSetId = storage.dataSetId;
      deal.uploadStartTime = new Date();

      const uploadResult: UploadResult = await storage.upload(dealInput.processedData.data, {
        onUploadComplete: (pieceCid) => this.handleUploadComplete(deal, pieceCid, dealInput.appliedAddons),
        onPieceAdded: (hash) => this.handleRootAdded(deal, hash),
      });

      this.updateDealWithUploadResult(deal, uploadResult);

      this.logger.log(
        `Deal created: ${uploadResult.pieceCid.toString().slice(0, 12)}... (${providerAddress.slice(0, 8)}...)`,
      );

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
      this.synapse = await Synapse.create({
        privateKey: this.blockchainConfig.walletPrivateKey,
        rpcURL: RPC_URLS[this.blockchainConfig.network].http,
        warmStorageAddress: this.walletSdkService.getFWSSAddress(),
      });
    }
    return this.synapse;
  }

  // ============================================================================
  // Parallel Processing
  // ============================================================================

  private async processProvidersInParallel(
    providers: ProviderInfoEx[],
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
    } catch (_err) {
      return await this.dataSourceService.fetchLocalDataset(minSize, maxSize);
    }
  }
}
