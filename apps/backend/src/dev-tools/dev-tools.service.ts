import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { SUPPORTED_NETWORKS } from "../common/constants.js";
import { type DealLogContext, toStructuredError } from "../common/logging.js";
import type { Network } from "../common/types.js";
import { Deal } from "../database/entities/deal.entity.js";
import { DealStatus, RetrievalStatus } from "../database/types.js";
import { DealService } from "../deal/deal.service.js";
import { RetrievalService } from "../retrieval/retrieval.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import type { TriggerDealResponseDto } from "./dto/trigger-deal.dto.js";
import type { RetrievalMethodResultDto, TriggerRetrievalResponseDto } from "./dto/trigger-retrieval.dto.js";

export const DEFAULT_NETWORK: Network = SUPPORTED_NETWORKS[0];

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
  listProviders(network: Network = DEFAULT_NETWORK): unknown[] {
    const providers = this.walletSdkService.getTestingProviders(network);
    this.logger.log({
      event: "providers_listed",
      message: "Listing available providers",
      network,
      count: providers.length,
    });
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
  async triggerDeal(spAddress: string, network: Network = DEFAULT_NETWORK): Promise<TriggerDealResponseDto> {
    this.logger.log({
      event: "deal_trigger_requested",
      message: "Triggering deal for storage provider",
      spAddress,
      network,
    });

    // Validate SP exists
    const providerInfo = this.walletSdkService.getProviderInfo(spAddress, network);
    if (!providerInfo) {
      throw new NotFoundException(`Storage provider not found: ${spAddress}`);
    }

    if (!providerInfo.isActive) {
      throw new BadRequestException(`Storage provider is not active: ${spAddress}`);
    }
    if (providerInfo.id == null) {
      throw new BadRequestException(`Storage provider is missing providerId: ${spAddress}`);
    }

    // Create a pending deal record first so we can return the ID immediately
    const pendingDeal = this.dealRepository.create({
      spAddress,
      network,
      walletAddress: this.dealService.getWalletAddress(network),
      fileName: "pending",
      fileSize: 0,
      status: DealStatus.PENDING,
      serviceTypes: [],
    });

    const savedDeal = await this.dealRepository.save(pendingDeal);
    const dealId = savedDeal.id;

    const dealLogContext: DealLogContext = {
      dealId,
      providerId: providerInfo.id,
      providerName: providerInfo.name,
      providerAddress: spAddress,
    };

    this.logger.log({
      event: "deal_pending_created",
      message: "Created pending deal, starting background processing",
      dealId,
      spAddress,
    });

    // Fire off the deal creation in the background (don't await)
    this.processDealInBackground(dealId, providerInfo, network, dealLogContext).catch((err) => {
      this.logger.error({
        ...dealLogContext,
        event: "background_deal_processing_failed",
        message: "Background deal processing failed",
        error: toStructuredError(err),
      });
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
    network: Network,
    dealLogContext: DealLogContext,
  ): Promise<void> {
    if (!providerInfo || providerInfo.id == null) {
      throw new Error(`Missing provider info for background deal ${dealId}`);
    }
    try {
      const deal = await this.dealService.createDealForProvider(providerInfo, {
        network,
        existingDealId: dealId,
        logContext: {
          network,
          jobId: "dev_tools_manual_deal",
          providerAddress: providerInfo.serviceProvider,
          providerId: providerInfo.id,
          providerName: providerInfo.name,
        },
      });

      this.logger.log({
        ...dealLogContext,
        event: "background_deal_completed",
        message: "Background deal completed successfully",
        pieceCid: deal.pieceCid,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({
        ...dealLogContext,
        event: "background_deal_failed",
        message: "Background deal processing failed",
        error: toStructuredError(error),
      });

      // Update deal with error status
      await this.dealRepository.update(dealId, {
        status: DealStatus.FAILED,
        errorMessage,
      });
    }
  }

  private dealToResponseDto(deal: Deal): TriggerDealResponseDto {
    return {
      id: deal.id,
      pieceCid: deal.pieceCid || "",
      status: deal.status,
      fileName: deal.fileName,
      fileSize: deal.fileSize,
      dealLatencyMs: deal.dealLatencyMs ?? undefined,
      dealLatencyWithIpniMs: deal.dealLatencyWithIpniMs ?? undefined,
      ingestLatencyMs: deal.ingestLatencyMs ?? undefined,
      ipniTimeToIndexMs: deal.ipniTimeToIndexMs ?? undefined,
      ipniTimeToAdvertiseMs: deal.ipniTimeToAdvertiseMs ?? undefined,
      ipniTimeToVerifyMs: deal.ipniTimeToVerifyMs ?? undefined,
      serviceTypes: deal.serviceTypes ?? [],
      spAddress: deal.spAddress,
      errorMessage: deal.errorMessage ?? undefined,
    };
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

    return this.dealToResponseDto(deal);
  }

  /**
   * Trigger data fetch for a deal by ID or most recent deal for an SP
   */
  async triggerRetrieval(
    dealId?: string,
    spAddress?: string,
    network: Network = DEFAULT_NETWORK,
  ): Promise<TriggerRetrievalResponseDto> {
    if (!dealId && !spAddress) {
      throw new BadRequestException("Either dealId or spAddress must be provided");
    }

    // Find the deal
    const deal = await this.findDeal(dealId, spAddress, network);
    const pieceCid = deal.pieceCid;
    if (!pieceCid) {
      throw new BadRequestException(`Deal ${deal.id} has no piece CID - cannot perform data fetch`);
    }

    this.logger.log({
      event: "retrieval_trigger_requested",
      message: "Triggering data fetch for deal",
      dealId: deal.id,
      pieceCid: deal.pieceCid,
    });

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

    this.logger.log({
      event: "retrieval_test_completed",
      message: "Data fetch test completed",
      successfulMethods: successfulMethods.length,
      totalMethods: retrievals.length,
    });

    return {
      dealId: deal.id,
      pieceCid,
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
  private async findDeal(dealId?: string, spAddress?: string, network: Network = DEFAULT_NETWORK): Promise<Deal> {
    let deal: Deal | null = null;

    if (dealId) {
      deal = await this.dealRepository.findOne({
        where: { id: dealId },
      });

      if (!deal) {
        throw new NotFoundException(`Deal not found: ${dealId}`);
      }
    } else if (spAddress) {
      // Find most recent successful deal for this SP on the given network
      deal = await this.dealRepository.findOne({
        where: [
          { spAddress, network, status: DealStatus.DEAL_CREATED },
          { spAddress, network, status: DealStatus.PIECE_ADDED },
        ],
        order: { createdAt: "DESC" },
      });

      if (!deal) {
        throw new NotFoundException(`No successful deals found for SP: ${spAddress} on network: ${network}`);
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
