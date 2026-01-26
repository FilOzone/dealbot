import { type PieceCID, RPC_URLS, SIZE_CONSTANTS, Synapse } from "@filoz/synapse-sdk";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { executeUpload } from "filecoin-pin";
import { CID } from "multiformats/cid";
import type { Repository } from "typeorm";
import { buildUnixfsCar } from "../common/car-utils.js";
import type { DataFile } from "../common/types.js";
import type { IBlockchainConfig, IConfig } from "../config/app.config.js";
import { Deal } from "../database/entities/deal.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { DealStatus, ServiceType } from "../database/types.js";
import { DataSourceService } from "../dataSource/dataSource.service.js";
import { DealAddonsService } from "../deal-addons/deal-addons.service.js";
import type { DealPreprocessingResult } from "../deal-addons/types.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import type { ProviderInfoEx } from "../wallet-sdk/wallet-sdk.types.js";

type UploadPayload = {
  carData: Uint8Array;
  rootCid: CID;
};

type UploadResultSummary = {
  pieceCid: string;
  pieceId?: number;
};

type SynapseServiceArg = Parameters<typeof executeUpload>[0];
type FilecoinPinLogger = Parameters<typeof executeUpload>[3]["logger"];

@Injectable()
export class DealService {
  private readonly logger = new Logger(DealService.name);
  private readonly blockchainConfig: IBlockchainConfig;

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
    let synapse: Synapse | undefined;

    try {
      synapse = await this.createSynapseForJob();

      const preprocessed = await this.dealAddonsService.preprocessDeal({
        enableCDN,
        enableIpni,
        dataFile,
      });

      const uploadPayload = await this.prepareUploadPayload(preprocessed);

      const providers = this.walletSdkService.getTestingProviders();

      const results = await this.processProvidersInParallel(synapse, providers, preprocessed, uploadPayload);

      const successfulDeals = results.filter((result) => result.success).map((result) => result.deal!);

      this.logger.log(`Deal creation completed: ${successfulDeals.length}/${totalProviders} successful`);

      return successfulDeals;
    } finally {
      // Cleanup random dataset file after all uploads complete (success or failure)
      await this.dataSourceService.cleanupRandomDataset(dataFile.name);
      if (synapse) {
        await this.cleanupSynapse(synapse);
      }
    }
  }

  async createDeal(
    synapse: Synapse,
    providerInfo: ProviderInfoEx,
    dealInput: DealPreprocessingResult,
    uploadPayload: UploadPayload,
  ): Promise<Deal> {
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

      const dataSetMetadata = { ...dealInput.synapseConfig.dataSetMetadata };

      if (this.blockchainConfig.dealbotDataSetVersion) {
        dataSetMetadata.dealbotDataSetVersion = this.blockchainConfig.dealbotDataSetVersion;
      }

      const storage = await synapse.storage.createContext({
        providerAddress,
        metadata: dataSetMetadata,
      });

      deal.dataSetId = storage.dataSetId;
      deal.uploadStartTime = new Date();

      const synapseService = { synapse, storage, providerInfo } as unknown as SynapseServiceArg;
      const uploadResult = await executeUpload(synapseService, uploadPayload.carData, uploadPayload.rootCid, {
        logger: this.createFilecoinPinLogger(),
        contextId: providerAddress,
        pieceMetadata: dealInput.synapseConfig.pieceMetadata,
        ipniValidation: { enabled: false },
        onProgress: (event) => {
          switch (event.type) {
            case "onUploadComplete":
              void this.handleUploadComplete(deal, event.data.pieceCid, dealInput.appliedAddons).catch((error) => {
                this.logger.warn(`Upload completion handler failed: ${error.message}`);
              });
              break;
            case "onPieceAdded":
              void this.handleRootAdded(deal, { transactionHash: event.data.txHash });
              break;
            default:
              break;
          }
        },
      });

      this.updateDealWithUploadResult(deal, uploadResult, uploadPayload.carData.length);

      if (!deal.transactionHash && uploadResult.transactionHash) {
        deal.transactionHash = uploadResult.transactionHash;
      }

      this.logger.log(`Deal created: ${uploadResult.pieceCid.slice(0, 12)}... (${providerAddress.slice(0, 8)}...)`);

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

  private async createSynapseForJob(): Promise<Synapse> {
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

  private async cleanupSynapse(synapse: Synapse): Promise<void> {
    try {
      await synapse.telemetry?.sentry?.close?.();
    } catch (error) {
      this.logger.warn(`Failed to cleanup Synapse telemetry: ${error.message}`);
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

  private createFilecoinPinLogger(): FilecoinPinLogger {
    const formatMessage = (payload: unknown, message?: string): string => {
      if (message) {
        return this.appendPayload(message, payload);
      }
      if (typeof payload === "string") {
        return payload;
      }
      return this.appendPayload("", payload);
    };

    return {
      info: (payload: unknown, message?: string) => this.logger.log(formatMessage(payload, message)),
      warn: (payload: unknown, message?: string) => this.logger.warn(formatMessage(payload, message)),
      error: (payload: unknown, message?: string) => this.logger.error(formatMessage(payload, message)),
      debug: (payload: unknown, message?: string) => this.logger.debug(formatMessage(payload, message)),
    } as FilecoinPinLogger;
  }

  private appendPayload(message: string, payload: unknown): string {
    if (payload === undefined || payload === null) {
      return message;
    }

    let serialized: string;
    if (payload instanceof Error) {
      serialized = payload.stack ?? payload.message;
    } else {
      try {
        serialized = JSON.stringify(payload);
      } catch {
        serialized = String(payload);
      }
    }

    if (!message) {
      return serialized;
    }

    return `${message} ${serialized}`;
  }

  private updateDealWithUploadResult(deal: Deal, uploadResult: UploadResultSummary, pieceSize: number): void {
    deal.pieceCid = uploadResult.pieceCid;
    deal.pieceSize = pieceSize;
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
    synapse: Synapse,
    providers: ProviderInfoEx[],
    dealInput: DealPreprocessingResult,
    uploadPayload: UploadPayload,
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
}
