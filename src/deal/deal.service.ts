import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Inject } from "@nestjs/common";
import { Deal } from "../domain/entities/deal.entity.js";
import { StorageProvider } from "../domain/entities/storage-provider.entity.js";
import { DataSourceService } from "../dataSource/dataSource.service.js";
import { DealStatus } from "../domain/enums/deal-status.enum.js";
import type { CreateDealInput, DataFile } from "../domain/interfaces/external-services.interface.js";
import type { IDealRepository, IStorageProviderRepository } from "../domain/interfaces/repositories.interface.js";
import type { IMetricsService } from "../domain/interfaces/metrics.interface.js";
import type { IBlockchainConfig, IConfig } from "../config/app.config.js";
import { type UploadResult, Synapse, RPC_URLS, SIZE_CONSTANTS, PieceCID, ProviderInfo } from "@filoz/synapse-sdk";
import type { Hex } from "../common/types.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";

@Injectable()
export class DealService {
  private readonly logger = new Logger(DealService.name);
  private synapse: Synapse;

  constructor(
    @Inject("IDealRepository")
    private readonly dealRepository: IDealRepository,
    private readonly dataSourceService: DataSourceService,
    private readonly configService: ConfigService<IConfig, true>,
    private readonly walletSdkService: WalletSdkService,
    @Inject("IMetricsService")
    private readonly metricsService: IMetricsService,
    @Inject("IStorageProviderRepository")
    private readonly storageProviderRepository: IStorageProviderRepository,
  ) {}

  async createDealsForAllProviders(): Promise<Deal[]> {
    const totalProviders = this.walletSdkService.getProviderCount();
    this.logger.log(`Creating deals for ${totalProviders} providers in parallel`);

    const dataFile = await this.fetchDataFile(SIZE_CONSTANTS.MIN_UPLOAD_SIZE, SIZE_CONSTANTS.MAX_UPLOAD_SIZE);

    // Process providers in parallel with controlled concurrency
    const results = await this.processProvidersInParallel(this.walletSdkService.approvedProviders, dataFile);

    const successfulDeals = results.filter((result) => result.success).map((result) => result.deal!);
    const failedCount = results.filter((result) => !result.success).length;

    this.logger.log(`Deal creation completed: ${successfulDeals.length} successful, ${failedCount} failed`);

    return successfulDeals;
  }

  async createDeal(dealInput: CreateDealInput): Promise<Deal> {
    const providerAddress = dealInput.provider.serviceProvider;
    this.logger.log(`Creating deal with provider ${providerAddress}`);

    // Fetch data from source
    const dataFile = dealInput.dataFile;

    // Create deal entity
    const deal = new Deal({
      fileName: dataFile.name,
      fileSize: dataFile.size,
      storageProvider: providerAddress as Hex,
      withCDN: dealInput.enableCDN,
      status: DealStatus.PENDING,
      walletAddress: this.configService.get<IBlockchainConfig>("blockchain").walletAddress as Hex,
    });
    let provider: StorageProvider | null = null;

    try {
      // Track storage provider data before deal creation
      provider = await this.trackStorageProvider(dealInput.provider, dealInput.enableCDN);

      // Upload file using Synapse SDK
      const synapse = await this.getStorageService();
      const storage = await synapse.createStorage({
        providerAddress,
        withCDN: dealInput.enableCDN,
      });
      deal.dataSetId = storage.dataSetId;
      deal.uploadStartTime = new Date();
      const uploadResult: UploadResult = await storage.upload(dataFile.data, {
        onUploadComplete: (pieceCid) => {
          this.handleUploadComplete(deal, provider!, pieceCid);
        },
        onPieceAdded: (result) => {
          this.handleRootAdded(deal, provider!, result?.hash);
        },
      });

      deal.cid = uploadResult.pieceCid.toString();
      deal.pieceSize = uploadResult.size;
      deal.dealId = `${storage.dataSetId}_${uploadResult.pieceId}`;
      deal.status = DealStatus.DEAL_CREATED;
      deal.dealConfirmedTime = new Date();
      deal.calculateDealLatency();

      this.logger.log(`Deal uploaded with CID: ${uploadResult.pieceCid.toString()}`);
      return deal;
    } catch (error) {
      this.logger.error(`Failed to create deal: ${error.message}`, error);

      deal.status = DealStatus.FAILED;
      deal.errorMessage = error.message;

      throw error;
    } finally {
      try {
        await Promise.all([
          this.dealRepository.create(deal),
          this.metricsService.recordDealMetrics(deal),
          this.updateProviderStats(provider, deal, deal.status === DealStatus.DEAL_CREATED, dealInput.enableCDN),
        ]);
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
      const blockchainConfig = this.configService.get<IBlockchainConfig>("blockchain");
      this.synapse = await Synapse.create({
        privateKey: blockchainConfig.walletPrivateKey,
        rpcURL: RPC_URLS[blockchainConfig.network].http,
      });
    }
    return this.synapse;
  }

  private async processProvidersInParallel(
    providers: ProviderInfo[],
    dataFile: DataFile,
    maxConcurrency: number = 10,
  ): Promise<Array<{ success: boolean; deal?: Deal; error?: string; provider: string }>> {
    const results: Array<{ success: boolean; deal?: Deal; error?: string; provider: string }> = [];

    // Process providers in batches to control concurrency
    for (let i = 0; i < providers.length; i += maxConcurrency) {
      const batch = providers.slice(i, i + maxConcurrency);

      const batchPromises = batch.map((provider) => this.createDealForProvider(provider, dataFile));
      const batchResults = await Promise.allSettled(batchPromises);

      // Process batch results
      batchResults.forEach((result, index) => {
        const provider = batch[index];

        if (result.status === "fulfilled") {
          results.push({
            success: true,
            deal: result.value,
            provider: provider.serviceProvider,
          });
        } else {
          const errorMessage = result.reason?.message || "Unknown error";
          results.push({
            success: false,
            error: errorMessage,
            provider: provider.serviceProvider,
          });

          this.logger.warn(`Deal creation failed for provider ${provider.serviceProvider}: ${errorMessage}`);
        }
      });
    }

    return results;
  }

  private async createDealForProvider(provider: ProviderInfo, dataFile: DataFile): Promise<Deal> {
    // Alternate between CDN enabled and disabled for A/B testing
    const enableCDN = Math.random() > 0.5;

    return await this.createDeal({
      enableCDN,
      provider,
      dataFile,
    });
  }

  private async handleUploadComplete(deal: Deal, provider: StorageProvider, pieceCid: PieceCID): Promise<void> {
    deal.cid = pieceCid.toString();
    deal.uploadEndTime = new Date();
    deal.calculateIngestLatency();
    deal.calculateIngestThroughput();
    deal.status = DealStatus.UPLOADED;

    provider.averageIngestLatency = this.calculateAvg(
      provider.averageIngestLatency,
      deal.ingestLatency || 0,
      provider.successfulDeals + 1,
    );
    provider.averageIngestThroughput = this.calculateAvg(
      provider.averageIngestThroughput,
      deal.ingestThroughput || 0,
      provider.successfulDeals + 1,
    );

    this.logger.log(`Deal upload completed with cid: ${deal.cid}`);
  }

  private async handleRootAdded(deal: Deal, provider: StorageProvider, result: any): Promise<void> {
    deal.pieceAddedTime = new Date();
    deal.calculateChainLatency();
    deal.status = DealStatus.PIECE_ADDED;
    deal.transactionHash = result.transactionHash;

    provider.averageChainLatency = this.calculateAvg(
      provider.averageChainLatency,
      deal.chainLatency || 0,
      provider.successfulDeals + 1,
    );

    this.logger.log(`Deal piece added with cid: ${deal.cid}`);
  }

  /**
   * Track storage provider data - create if doesn't exist, update if exists
   */
  private async trackStorageProvider(providerInfo: ProviderInfo, withCDN: boolean): Promise<StorageProvider> {
    const providerAddress = providerInfo.serviceProvider;
    try {
      let provider = await this.storageProviderRepository.findByAddress(providerAddress);

      if (!provider) {
        provider = new StorageProvider({
          address: providerAddress as Hex,
          name: providerInfo.name,
          description: providerInfo.description,
          payee: providerInfo.payee,
          serviceUrl: providerInfo.products.PDP?.data.serviceURL,
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
  private async updateProviderStats(
    provider: StorageProvider | null,
    deal: Deal,
    isSuccessful: boolean,
    withCDN: boolean,
  ): Promise<void> {
    if (!provider) {
      this.logger.warn(`Provider not found for deal ${deal.id}`);
      return;
    }

    try {
      provider.successfulDeals = provider.successfulDeals + (isSuccessful ? 1 : 0);
      provider.successfulDealsWithCDN = provider.successfulDealsWithCDN + (isSuccessful && withCDN ? 1 : 0);
      provider.successfulDealsWithoutCDN = provider.successfulDealsWithoutCDN + (isSuccessful && !withCDN ? 1 : 0);
      provider.failedDeals = provider.failedDeals + (isSuccessful ? 0 : 1);
      provider.failedDealsWithCDN = provider.failedDealsWithCDN + (isSuccessful ? 0 : withCDN ? 1 : 0);
      provider.failedDealsWithoutCDN = provider.failedDealsWithoutCDN + (isSuccessful ? 0 : !withCDN ? 1 : 0);
      provider.totalDeals = provider.successfulDeals + provider.failedDeals;
      provider.calculateDealSuccessRate();
      provider.averageDealLatency = this.calculateAvg(
        provider.averageDealLatency,
        deal.dealLatency || 0,
        provider.successfulDeals,
      );

      await this.storageProviderRepository.upsert(provider);
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

  private calculateAvg(prevAvg: number, newValue: number, count: number): number {
    return prevAvg ? (prevAvg * (count - 1) + newValue) / count : newValue;
  }
}
