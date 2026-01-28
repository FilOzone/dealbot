import { SIZE_CONSTANTS } from "@filoz/synapse-sdk";
import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import type { Hex } from "../common/types.js";
import type { IBlockchainConfig, IConfig, IpniTestingMode } from "../config/app.config.js";
import { Deal } from "../database/entities/deal.entity.js";
import { DealStatus } from "../database/types.js";
import { DataSourceService } from "../dataSource/dataSource.service.js";
import { DealService } from "../deal/deal.service.js";
import { DealAddonsService } from "../deal-addons/deal-addons.service.js";
import { RetrievalAddonsService } from "../retrieval-addons/retrieval-addons.service.js";
import type { RetrievalConfiguration } from "../retrieval-addons/types.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import type { TriggerDealResponseDto } from "./dto/trigger-deal.dto.js";
import type { RetrievalMethodResultDto, TriggerRetrievalResponseDto } from "./dto/trigger-retrieval.dto.js";

@Injectable()
export class DevToolsService {
  private readonly logger = new Logger(DevToolsService.name);
  private readonly blockchainConfig: IBlockchainConfig;

  constructor(
    private readonly walletSdkService: WalletSdkService,
    private readonly dataSourceService: DataSourceService,
    private readonly dealAddonsService: DealAddonsService,
    private readonly dealService: DealService,
    private readonly retrievalAddonsService: RetrievalAddonsService,
    private readonly configService: ConfigService<IConfig, true>,
    @InjectRepository(Deal)
    private readonly dealRepository: Repository<Deal>,
  ) {
    this.blockchainConfig = this.configService.get("blockchain");
  }

  /**
   * List all available storage providers for testing
   */
  listProviders(): unknown[] {
    const providers = this.walletSdkService.getTestingProviders();
    this.logger.log(`Listing ${providers.length} available providers`);
    // Serialize BigInt values to strings for JSON response
    return providers.map((p) => this.serializeBigInt(p));
  }

  /**
   * Recursively convert BigInt values to strings for JSON serialization
   */
  private serializeBigInt(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === "bigint") {
      return obj.toString();
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.serializeBigInt(item));
    }

    if (typeof obj === "object") {
      const serialized: Record<string, unknown> = {};
      for (const key in obj) {
        if (Object.hasOwn(obj, key)) {
          serialized[key] = this.serializeBigInt((obj as Record<string, unknown>)[key]);
        }
      }
      return serialized;
    }

    return obj;
  }

  /**
   * Trigger a deal for a specific storage provider.
   * Returns immediately with deal ID - processing happens in background.
   */
  async triggerDeal(spAddress: string): Promise<TriggerDealResponseDto> {
    this.logger.log(`Triggering deal for SP: ${spAddress}`);

    // Validate SP exists
    const providerInfo = this.walletSdkService.getProviderInfo(spAddress);
    if (!providerInfo) {
      throw new NotFoundException(`Storage provider not found: ${spAddress}`);
    }

    if (!providerInfo.active) {
      throw new BadRequestException(`Storage provider is not active: ${spAddress}`);
    }

    // Get CDN/IPNI settings from config
    const enableCDN = this.blockchainConfig.enableCDNTesting;
    const enableIpni = this.getIpniEnabled(this.blockchainConfig.enableIpniTesting);

    this.logger.log(`Deal settings - CDN: ${enableCDN}, IPNI: ${enableIpni}`);

    // Create a pending deal record first so we can return the ID immediately
    const pendingDeal = this.dealRepository.create({
      spAddress,
      walletAddress: this.blockchainConfig.walletAddress,
      fileName: "pending",
      fileSize: 0,
      status: DealStatus.PENDING,
      serviceTypes: [],
    });

    const savedDeal = await this.dealRepository.save(pendingDeal);
    const dealId = savedDeal.id;

    this.logger.log(`Created pending deal ${dealId}, starting background processing`);

    // Fire off the deal creation in the background (don't await)
    this.processDealInBackground(dealId, providerInfo, enableCDN, enableIpni).catch((err) => {
      this.logger.error(`Background deal processing failed for ${dealId}: ${err.message}`);
    });

    // Return immediately with the pending deal info
    return {
      id: dealId,
      pieceCid: "",
      status: DealStatus.PENDING,
      fileName: "pending",
      fileSize: 0,
      serviceTypes: [],
      spAddress,
    };
  }

  /**
   * Process deal creation in the background
   */
  private async processDealInBackground(
    dealId: string,
    providerInfo: ReturnType<typeof this.walletSdkService.getProviderInfo>,
    enableCDN: boolean,
    enableIpni: boolean,
  ): Promise<void> {
    let dataFile: Awaited<ReturnType<typeof this.fetchDataFile>> | null = null;

    try {
      // Fetch data file
      dataFile = await this.fetchDataFile(SIZE_CONSTANTS.MIN_UPLOAD_SIZE, SIZE_CONSTANTS.MAX_UPLOAD_SIZE);

      // Update the pending deal with file info
      await this.dealRepository.update(dealId, {
        fileName: dataFile.name,
        fileSize: dataFile.size,
      });

      // Preprocess deal
      const preprocessed = await this.dealAddonsService.preprocessDeal({
        enableCDN,
        enableIpni,
        dataFile,
      });

      // Create deal (this will create its own deal record, but we'll use ours for tracking)
      const deal = await this.dealService.createDeal(providerInfo!, preprocessed);

      // Update our pending deal record with the results
      await this.dealRepository.update(dealId, {
        pieceCid: deal.pieceCid,
        pieceSize: deal.pieceSize,
        pieceId: deal.pieceId,
        dataSetId: deal.dataSetId,
        status: deal.status,
        transactionHash: deal.transactionHash,
        metadata: deal.metadata,
        serviceTypes: deal.serviceTypes,
        uploadStartTime: deal.uploadStartTime,
        uploadEndTime: deal.uploadEndTime,
        pieceAddedTime: deal.pieceAddedTime,
        dealConfirmedTime: deal.dealConfirmedTime,
        ingestLatencyMs: deal.ingestLatencyMs,
        chainLatencyMs: deal.chainLatencyMs,
        dealLatencyMs: deal.dealLatencyMs,
        ingestThroughputBps: deal.ingestThroughputBps,
        fileName: deal.fileName,
        fileSize: deal.fileSize,
      });

      // Delete the duplicate deal record created by dealService
      if (deal.id !== dealId) {
        await this.dealRepository.delete(deal.id);
      }

      this.logger.log(`Background deal ${dealId} completed successfully: ${deal.pieceCid?.slice(0, 12)}...`);
    } catch (error) {
      this.logger.error(`Background deal ${dealId} failed: ${error.message}`);

      // Update deal with error status
      await this.dealRepository.update(dealId, {
        status: DealStatus.FAILED,
        errorMessage: error.message,
      });
    } finally {
      // Cleanup random dataset file
      if (dataFile) {
        await this.dataSourceService.cleanupRandomDataset(dataFile.name);
      }
    }
  }

  /**
   * Get deal status by ID
   */
  async getDeal(dealId: string): Promise<TriggerDealResponseDto> {
    const deal = await this.dealRepository.findOne({
      where: { id: dealId },
    });

    if (!deal) {
      throw new NotFoundException(`Deal not found: ${dealId}`);
    }

    return {
      id: deal.id,
      pieceCid: deal.pieceCid || "",
      status: deal.status,
      fileName: deal.fileName,
      fileSize: deal.fileSize,
      dealLatencyMs: deal.dealLatencyMs,
      ingestLatencyMs: deal.ingestLatencyMs,
      serviceTypes: deal.serviceTypes || [],
      spAddress: deal.spAddress,
      errorMessage: deal.errorMessage,
    };
  }

  /**
   * Trigger data fetch for a deal by ID or most recent deal for an SP
   */
  async triggerRetrieval(dealId?: string, spAddress?: string): Promise<TriggerRetrievalResponseDto> {
    if (!dealId && !spAddress) {
      throw new BadRequestException("Either dealId or spAddress must be provided");
    }

    // Find the deal
    const deal = await this.findDeal(dealId, spAddress);

    this.logger.log(`Triggering data fetch for deal: ${deal.id} (piece: ${deal.pieceCid?.slice(0, 12)}...)`);

    // Build configuration
    const config: RetrievalConfiguration = {
      deal,
      walletAddress: deal.walletAddress as Hex,
      storageProvider: deal.spAddress as Hex,
    };

    // Test all methods
    const testResult = await this.retrievalAddonsService.testAllRetrievalMethods(config);

    // Map results to response DTOs
    const results: RetrievalMethodResultDto[] = testResult.results.map((r) => ({
      method: r.method,
      success: r.success,
      url: r.url,
      latencyMs: r.success ? Math.round(r.metrics.latency) : undefined,
      ttfbMs: r.success ? Math.round(r.metrics.ttfb) : undefined,
      throughputBps: r.success ? Math.round(r.metrics.throughput) : undefined,
      statusCode: r.metrics.statusCode || undefined,
      responseSize: r.metrics.responseSize || undefined,
      error: r.error,
      retryCount: r.retryCount,
    }));

    this.logger.log(
      `Data fetch test completed: ${testResult.summary.successfulMethods}/${testResult.summary.totalMethods} successful`,
    );

    return {
      dealId: deal.id,
      pieceCid: deal.pieceCid,
      spAddress: deal.spAddress,
      results,
      summary: testResult.summary,
      testedAt: testResult.testedAt,
    };
  }

  /**
   * Find a deal by ID or most recent deal for an SP
   */
  private async findDeal(dealId?: string, spAddress?: string): Promise<Deal> {
    let deal: Deal | null = null;

    if (dealId) {
      deal = await this.dealRepository.findOne({
        where: { id: dealId },
      });

      if (!deal) {
        throw new NotFoundException(`Deal not found: ${dealId}`);
      }
    } else if (spAddress) {
      // Find most recent successful deal for this SP
      deal = await this.dealRepository.findOne({
        where: [
          { spAddress, status: DealStatus.DEAL_CREATED },
          { spAddress, status: DealStatus.PIECE_ADDED },
        ],
        order: { createdAt: "DESC" },
      });

      if (!deal) {
        throw new NotFoundException(`No successful deals found for SP: ${spAddress}`);
      }
    }

    if (!deal) {
      throw new BadRequestException("Either dealId or spAddress must be provided");
    }

    // Validate deal has required data
    if (!deal.pieceCid) {
      throw new BadRequestException(`Deal ${deal.id} has no piece CID - cannot perform data fetch`);
    }

    return deal;
  }

  /**
   * Determine if IPNI is enabled based on config mode
   */
  private getIpniEnabled(mode: IpniTestingMode): boolean {
    switch (mode) {
      case "disabled":
        return false;
      case "random":
        return Math.random() > 0.5;
      case "always":
      default:
        return true;
    }
  }

  /**
   * Fetch a data file for deal creation
   */
  private async fetchDataFile(minSize: number, maxSize: number) {
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
