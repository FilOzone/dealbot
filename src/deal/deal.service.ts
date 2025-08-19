import { Injectable, Logger, Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Deal } from "../domain/entities/deal.entity";
import { DealStatus, DataSourceType } from "../domain/enums/deal-status.enum";
import type { IDealRepository } from "../domain/interfaces/repositories.interface";
import type { CreateDealInput, DataFile } from "../domain/interfaces/external-services.interface";
import { DataSourceService } from "../dataSource/dataSource.service";
import { ZERO_ADDRESS } from "../common/constants";
import { IAppConfig } from "../config/app.config";
import { providers } from "../common/providers";
import { IProvider } from "../domain/interfaces/provider.interface";
import { UploadResult, Synapse, RPC_URLS } from "@filoz/synapse-sdk";
import { Hex } from "../common/types";

@Injectable()
export class DealService {
  private readonly logger = new Logger(DealService.name);
  private synapse: Synapse;

  constructor(
    @Inject("IDealRepository")
    private readonly dealRepository: IDealRepository,
    @Inject("IStorageProviderRepository")
    private readonly dataSourceService: DataSourceService,
    private readonly configService: ConfigService<IAppConfig>,
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

  async createDeal(dto: CreateDealInput): Promise<Deal> {
    this.logger.log(`Creating deal with provider`);

    // Fetch data from source
    const dataFile = await this.fetchDataFile(dto.dataSource, dto.maxFileSize || 250);

    this.logger.log(`Fetched data file: ${dataFile.name}`);

    // Create deal entity
    const deal = new Deal({
      fileName: dataFile.name,
      fileSize: dataFile.size,
      storageProvider: dto.storageProviderAddress || ZERO_ADDRESS,
      withCDN: dto.enableCDN,
      status: DealStatus.PENDING,
      walletAddress: this.configService.get("blockchain").walletAddress,
    });

    try {
      // Save initial deal
      const savedDeal = await this.dealRepository.create(deal);
      const savedDealId = savedDeal.id;

      // Upload file using Synapse SDK
      const synapse = await this.getStorageService();
      const storage = await synapse.createStorage({
        providerAddress: dto.storageProviderAddress,
        withCDN: dto.enableCDN,
      });
      savedDeal.uploadStartTime = new Date();
      await this.dealRepository.update(savedDealId, {
        uploadStartTime: savedDeal.uploadStartTime,
      });
      const uploadResult: UploadResult = await storage.upload(dataFile.data, {
        onUploadComplete: () => {
          this.handleUploadComplete(savedDeal);
        },
        onRootAdded: (result) => {
          this.handleRootAdded(savedDeal, result?.hash);
        },
      });

      savedDeal.cid = uploadResult.commp.toString();
      savedDeal.pieceSize = uploadResult.size;
      savedDeal.dealId = `${storage.proofSetId}_${uploadResult.rootId}`;
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

      this.logger.log(`Deal ${uploadResult.size} uploaded with CID: ${uploadResult.commp.toString()}`);
      return savedDeal;
    } catch (error) {
      this.logger.error(`Failed to create deal: ${error.message}`, error);
      throw error;
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
      maxFileSize: 250 * 1024 * 1024,
    });
  }

  private async handleUploadComplete(deal: Deal): Promise<void> {
    await this.dealRepository.update(deal.id, {
      uploadEndTime: new Date(),
      status: DealStatus.UPLOADED,
    });

    // Calculate and update ingest latency
    deal.uploadEndTime = new Date();
    deal.calculateIngestLatency();
    await this.dealRepository.update(deal.id, {
      ingestLatency: deal.ingestLatency,
    });
  }

  private async handleRootAdded(deal: Deal, txHash?: string): Promise<void> {
    await this.dealRepository.update(deal.id, {
      transactionHash: txHash as Hex,
      pieceAddedTime: new Date(),
      status: DealStatus.PIECE_ADDED,
    });

    // Calculate and update chain latency
    deal.pieceAddedTime = new Date();
    deal.calculateChainLatency();
    await this.dealRepository.update(deal.id, {
      chainLatency: deal.chainLatency,
    });
  }

  private async fetchDataFile(source: DataSourceType, maxSize: number): Promise<DataFile> {
    switch (source) {
      case DataSourceType.LOCAL:
        const localData = await this.dataSourceService.fetchLocalDataset(1, maxSize);
        return localData[0];
      default:
        throw new Error(`Unsupported data source: ${source}`);
    }
  }
}
