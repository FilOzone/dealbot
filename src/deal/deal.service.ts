import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Inject } from "@nestjs/common";
import { Deal } from "../domain/entities/deal.entity";
import { StorageProvider } from "../domain/entities/storage-provider.entity";
import { DataSourceService } from "../dataSource/dataSource.service";
import { DealStatus, DataSourceType } from "../domain/enums/deal-status.enum";
import type { CreateDealInput, DataFile } from "../domain/interfaces/external-services.interface";
import type { IDealRepository, IStorageProviderRepository } from "../domain/interfaces/repositories.interface";
import type { IMetricsService } from "../domain/interfaces/metrics.interface";
import type { IAppConfig } from "../config/app.config";
import { ZERO_ADDRESS } from "../common/constants";
import { getProvider, providers } from "../common/providers";
import type { IProvider } from "../domain/interfaces/provider.interface";
import { type UploadResult, Synapse, RPC_URLS } from "@filoz/synapse-sdk";
import type { Hex } from "../common/types";

@Injectable()
export class DealService {
  private readonly logger = new Logger(DealService.name);
  private synapse: Synapse;

  constructor(
    @Inject("IDealRepository")
    private readonly dealRepository: IDealRepository,
    private readonly dataSourceService: DataSourceService,
    private readonly configService: ConfigService<IAppConfig>,
    @Inject("IMetricsService")
    private readonly metricsService: IMetricsService,
    @Inject("IStorageProviderRepository")
    private readonly storageProviderRepository: IStorageProviderRepository,
  ) {}

  async createDealsForAllProviders(): Promise<Deal[]> {
    const providersList = Object.values<IProvider>(providers);
    const totalProviders = providersList.length;

    this.logger.log(`Creating deals for ${totalProviders} providers in parallel`);

    // Process providers in parallel with controlled concurrency
    const results = await this.processProvidersInParallel(providersList);

    const successfulDeals = results.filter((result) => result.success).map((result) => result.deal!);
    const failedCount = results.filter((result) => !result.success).length;

    this.logger.log(`Deal creation completed: ${successfulDeals.length} successful, ${failedCount} failed`);

    return successfulDeals;
  }

  async createDeal(dealInput: CreateDealInput): Promise<Deal> {
    this.logger.log(`Creating deal with provider ${dealInput.storageProviderAddress}`);

    // Fetch data from source
    const dataFile = await this.fetchDataFile(dealInput.minFileSize || 10, dealInput.maxFileSize || 250);

    this.logger.log(`Fetched data file: ${dataFile.name}`);

    // Create deal entity
    const deal = new Deal({
      fileName: dataFile.name,
      fileSize: dataFile.size,
      storageProvider: dealInput.storageProviderAddress || ZERO_ADDRESS,
      withCDN: dealInput.enableCDN,
      status: DealStatus.PENDING,
      walletAddress: this.configService.get("blockchain").walletAddress,
    });
    const savedDeal = await this.dealRepository.create(deal);
    const savedDealId = savedDeal.id;
    let provider: StorageProvider | null = null;

    try {
      // Track storage provider data before deal creation
      provider = await this.trackStorageProvider(dealInput.storageProviderAddress || ZERO_ADDRESS, dealInput.enableCDN);

      // Upload file using Synapse SDK
      const synapse = await this.getStorageService();
      const storage = await synapse.createStorage({
        providerAddress: dealInput.storageProviderAddress,
        withCDN: dealInput.enableCDN,
      });
      savedDeal.uploadStartTime = new Date();
      await this.dealRepository.update(savedDealId, {
        uploadStartTime: savedDeal.uploadStartTime,
      });
      const uploadResult: UploadResult = await storage.upload(dataFile.data, {
        onUploadComplete: () => {
          this.handleUploadComplete(savedDeal, provider!);
        },
        onPieceAdded: (result) => {
          this.handleRootAdded(savedDeal, provider!, result?.hash);
        },
      });

      savedDeal.cid = uploadResult.pieceCid.toString();
      savedDeal.pieceSize = uploadResult.size;
      savedDeal.dealId = `${storage.dataSetId}_${uploadResult.pieceId}`;
      savedDeal.status = DealStatus.DEAL_CREATED;
      savedDeal.dealConfirmedTime = new Date();
      savedDeal.calculateDealLatency();

      await this.dealRepository.update(savedDealId, {
        cid: savedDeal.cid,
        pieceSize: savedDeal.pieceSize,
        dealId: savedDeal.dealId,
        status: savedDeal.status,
        dealConfirmedTime: savedDeal.dealConfirmedTime,
        dealLatency: savedDeal.dealLatency,
      });

      provider.averageDealLatency = provider.averageDealLatency
        ? (provider.averageDealLatency + (deal.dealLatency || 0)) / 2
        : deal.dealLatency || 0;
      await this.updateProviderStats(provider, true, dealInput.enableCDN);

      this.logger.log(`Deal uploaded with CID: ${uploadResult.pieceCid.toString()}`);
      return savedDeal;
    } catch (error) {
      this.logger.error(`Failed to create deal: ${error.message}`, error);

      if (provider) await this.updateProviderStats(provider, false, dealInput.enableCDN);

      await this.dealRepository.update(deal.id, {
        status: DealStatus.FAILED,
        errorMessage: error.message,
      });

      throw error;
    } finally {
      try {
        await this.metricsService.recordDealMetrics(savedDeal);
      } catch (error) {
        this.logger.warn(`Failed to record deal metrics: ${error.message}`);
      }
    }
  }

  async getMetrics(startDate: Date, endDate: Date) {
    return this.dealRepository.getMetrics(startDate, endDate);
  }

  private async getStorageService(): Promise<Synapse> {
    if (!this.synapse) {
      this.synapse = await Synapse.create({
        privateKey: this.configService.get("blockchain").walletPrivateKey,
        rpcURL: RPC_URLS.calibration.http,
      });
    }
    return this.synapse;
  }

  private async processProvidersInParallel(
    providers: IProvider[],
    maxConcurrency: number = 10,
  ): Promise<Array<{ success: boolean; deal?: Deal; error?: string; provider: string }>> {
    const results: Array<{ success: boolean; deal?: Deal; error?: string; provider: string }> = [];

    // Process providers in batches to control concurrency
    for (let i = 0; i < providers.length; i += maxConcurrency) {
      const batch = providers.slice(i, i + maxConcurrency);

      const batchPromises = batch.map((provider) => this.createDealForProvider(provider));
      const batchResults = await Promise.allSettled(batchPromises);

      // Process batch results
      batchResults.forEach((result, index) => {
        const provider = batch[index];

        if (result.status === "fulfilled") {
          results.push({
            success: true,
            deal: result.value,
            provider: provider.address,
          });
        } else {
          const errorMessage = result.reason?.message || "Unknown error";
          results.push({
            success: false,
            error: errorMessage,
            provider: provider.address,
          });

          this.logger.warn(`Deal creation failed for provider ${provider.address}: ${errorMessage}`);
        }
      });
    }

    return results;
  }

  private async createDealForProvider(provider: IProvider): Promise<Deal> {
    // Alternate between CDN enabled and disabled for A/B testing
    const enableCDN = Math.random() > 0.5;

    return await this.createDeal({
      dataSource: DataSourceType.LOCAL,
      enableCDN,
      storageProviderAddress: provider.address,
      minFileSize: 256 * 1024, // 256 KB
      maxFileSize: 250 * 1024 * 1024, // 250 MB
    });
  }

  private async handleUploadComplete(deal: Deal, provider: StorageProvider): Promise<void> {
    deal.uploadEndTime = new Date();
    deal.calculateIngestLatency();
    deal.status = DealStatus.UPLOADED;
    await this.dealRepository.update(deal.id, {
      ingestLatency: deal.ingestLatency,
      uploadEndTime: deal.uploadEndTime,
      status: deal.status,
    });

    provider.averageIngestLatency = provider.averageIngestLatency
      ? (provider.averageIngestLatency + (deal.ingestLatency || 0)) / 2
      : deal.ingestLatency || 0;
    await this.storageProviderRepository.update(provider.address, {
      averageIngestLatency: provider.averageIngestLatency,
    });

    this.logger.log(`Deal upload completed for ${deal.id}`);
  }

  private async handleRootAdded(deal: Deal, provider: StorageProvider, result: any): Promise<void> {
    deal.pieceAddedTime = new Date();
    deal.calculateChainLatency();
    deal.status = DealStatus.PIECE_ADDED;
    await this.dealRepository.update(deal.id, {
      transactionHash: result.transactionHash,
      pieceAddedTime: deal.pieceAddedTime,
      chainLatency: deal.chainLatency,
      status: deal.status,
    });

    provider.averageChainLatency = provider.averageChainLatency
      ? (provider.averageChainLatency + (deal.chainLatency || 0)) / 2
      : deal.chainLatency || 0;
    await this.storageProviderRepository.update(provider.address, {
      averageChainLatency: provider.averageChainLatency,
    });

    this.logger.log(`Deal root added for ${deal.id}`);
  }

  /**
   * Track storage provider data - create if doesn't exist, update if exists
   */
  private async trackStorageProvider(providerAddress: Hex, withCDN: boolean): Promise<StorageProvider> {
    try {
      let provider = await this.storageProviderRepository.findByAddress(providerAddress);

      if (!provider) {
        const providerInfo = getProvider(providerAddress);
        provider = new StorageProvider({
          address: providerAddress,
          serviceUrl: providerInfo.serviceUrl,
          totalDeals: 0,
          totalDealsWithCDN: 0,
          totalDealsWithoutCDN: 0,
          successfulDeals: 0,
          successfulDealsWithCDN: 0,
          successfulDealsWithoutCDN: 0,
          failedDeals: 0,
          failedDealsWithCDN: 0,
          failedDealsWithoutCDN: 0,
          dealSuccessRate: 0,
          retrievalSuccessRate: 0,
        });

        provider = await this.storageProviderRepository.create(provider);
        this.logger.debug(`Created new storage provider: ${providerAddress}`);
      }

      const updatedStats = {
        totalDeals: provider.totalDeals + 1,
        totalDealsWithCDN: withCDN ? provider.totalDealsWithCDN + 1 : provider.totalDealsWithCDN,
        totalDealsWithoutCDN: withCDN ? provider.totalDealsWithoutCDN : provider.totalDealsWithoutCDN + 1,
        lastDealTime: new Date(),
      };

      provider = await this.storageProviderRepository.update(provider.address, updatedStats);
      return provider;
    } catch (error) {
      this.logger.warn(`Failed to track storage provider ${providerAddress}: ${error.message}`);
      throw error;
    }
  }
  /**
   * Update storage provider stats after deal completion
   */
  private async updateProviderStats(provider: StorageProvider, isSuccessful: boolean, withCDN: boolean): Promise<void> {
    try {
      const successfulDeals = provider.successfulDeals + (isSuccessful ? 1 : 0);
      const successfulDealsWithCDN = provider.successfulDealsWithCDN + (isSuccessful && withCDN ? 1 : 0);
      const successfulDealsWithoutCDN = provider.successfulDealsWithoutCDN + (isSuccessful && !withCDN ? 1 : 0);
      const failedDeals = provider.failedDeals + (isSuccessful ? 0 : 1);
      const failedDealsWithCDN = provider.failedDealsWithCDN + (isSuccessful && withCDN ? 0 : 1);
      const failedDealsWithoutCDN = provider.failedDealsWithoutCDN + (isSuccessful && !withCDN ? 0 : 1);
      const totalDeals = successfulDeals + failedDeals;
      const successRate = totalDeals > 0 ? (successfulDeals / totalDeals) * 100 : 0;

      const updatedStats = {
        successfulDeals,
        successfulDealsWithCDN,
        successfulDealsWithoutCDN,
        failedDeals,
        failedDealsWithCDN,
        failedDealsWithoutCDN,
        dealSuccessRate: successRate,
      };

      await this.storageProviderRepository.update(provider.address, updatedStats);
      this.logger.debug(`Updated provider success stats: ${provider.address}, Success: ${isSuccessful}`);
    } catch (error) {
      this.logger.warn(`Failed to update provider stats ${provider.address}: ${error.message}`);
    }
  }

  private async fetchDataFile(minSize: number, maxSize: number): Promise<DataFile> {
    try {
      return await this.dataSourceService.fetchKaggleDataset(minSize, maxSize);
    } catch (err) {
      // Fallback to local datasets
      try {
        return await this.dataSourceService.fetchLocalDataset(minSize, maxSize);
      } catch (err) {
        throw err;
      }
    }
  }
}
