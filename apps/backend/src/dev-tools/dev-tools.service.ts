import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { Deal } from "../database/entities/deal.entity.js";
import { DealStatus, RetrievalStatus } from "../database/types.js";
import { DealService } from "../deal/deal.service.js";
import { RetrievalService } from "../retrieval/retrieval.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import type { TriggerDealResponseDto } from "./dto/trigger-deal.dto.js";
import type { RetrievalMethodResultDto, TriggerRetrievalResponseDto } from "./dto/trigger-retrieval.dto.js";

@Injectable()
export class DevToolsService {
  private readonly logger = new Logger(DevToolsService.name);

  constructor(
    private readonly walletSdkService: WalletSdkService,
    private readonly dealService: DealService,
    private readonly retrievalService: RetrievalService,
    @InjectRepository(Deal)
    private readonly dealRepository: Repository<Deal>,
  ) {}

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
    const { enableCDN, enableIpni } = this.dealService.getTestingDealOptions();

    this.logger.log(`Deal settings - CDN: ${enableCDN}, IPNI: ${enableIpni}`);

    // Create a pending deal record first so we can return the ID immediately
    const pendingDeal = this.dealRepository.create({
      spAddress,
      walletAddress: this.dealService.getWalletAddress(),
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
    try {
      const deal = await this.dealService.createDealForProvider(providerInfo!, {
        enableCDN,
        enableIpni,
        existingDealId: dealId,
      });

      this.logger.log(`Background deal ${dealId} completed successfully: ${deal.pieceCid?.slice(0, 12)}...`);
    } catch (error) {
      this.logger.error(`Background deal ${dealId} failed: ${error.message}`);

      // Update deal with error status
      await this.dealRepository.update(dealId, {
        status: DealStatus.FAILED,
        errorMessage: error.message,
      });
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

    const retrievals = await this.retrievalService.performRetrievalsForDeal(deal);

    const results: RetrievalMethodResultDto[] = retrievals.map((retrieval) => ({
      method: retrieval.serviceType,
      success: retrieval.status === RetrievalStatus.SUCCESS,
      url: retrieval.retrievalEndpoint,
      latencyMs: retrieval.latencyMs ?? undefined,
      ttfbMs: retrieval.ttfbMs ?? undefined,
      throughputBps: retrieval.throughputBps ?? undefined,
      statusCode: retrieval.responseCode ?? undefined,
      responseSize: retrieval.bytesRetrieved ?? undefined,
      error: retrieval.errorMessage ?? undefined,
      retryCount: retrieval.retryCount ?? undefined,
    }));

    const successfulMethods = retrievals.filter((retrieval) => retrieval.status === RetrievalStatus.SUCCESS);
    const fastest = successfulMethods.reduce<{ method?: string; latency?: number }>((current, retrieval) => {
      if (typeof retrieval.latencyMs !== "number") {
        return current;
      }
      if (current.latency === undefined || retrieval.latencyMs < current.latency) {
        return { method: retrieval.serviceType, latency: retrieval.latencyMs };
      }
      return current;
    }, {});

    const completedTimes = retrievals
      .map((retrieval) => retrieval.completedAt || retrieval.updatedAt || retrieval.createdAt)
      .filter((time): time is Date => Boolean(time));
    const testedAt = completedTimes.length > 0 ? completedTimes.reduce((max, time) => (time > max ? time : max)) : null;

    this.logger.log(`Data fetch test completed: ${successfulMethods.length}/${retrievals.length} successful`);

    return {
      dealId: deal.id,
      pieceCid: deal.pieceCid,
      spAddress: deal.spAddress,
      results,
      summary: {
        totalMethods: retrievals.length,
        successfulMethods: successfulMethods.length,
        failedMethods: retrievals.length - successfulMethods.length,
        fastestMethod: fastest.method,
        fastestLatency: fastest.latency,
      },
      testedAt: testedAt ?? new Date(),
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
}
