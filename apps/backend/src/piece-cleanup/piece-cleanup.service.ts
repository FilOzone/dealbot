import { Synapse } from "@filoz/synapse-sdk";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { calculateActualStorage, listDataSets } from "filecoin-pin/core/data-set";
import { IsNull, Not, Repository } from "typeorm";
import { type PieceCleanupLogContext, type ProviderJobContext, toStructuredError } from "../common/logging.js";
import { createSynapseFromConfig } from "../common/synapse-factory.js";
import type { IBlockchainConfig, IConfig } from "../config/app.config.js";
import { Deal } from "../database/entities/deal.entity.js";
import { DealStatus } from "../database/types.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";

export interface CleanupResult {
  /** Number of pieces successfully deleted. */
  deleted: number;
  /** Number of pieces that failed to delete. */
  failed: number;
  /** Whether cleanup was skipped (below threshold). */
  skipped: boolean;
  /** Total stored bytes before cleanup. */
  storedBytes: number;
  /** Threshold in bytes. */
  thresholdBytes: number;
}

@Injectable()
export class PieceCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PieceCleanupService.name);
  private readonly blockchainConfig: IBlockchainConfig;
  private sharedSynapse?: Synapse;

  constructor(
    private readonly configService: ConfigService<IConfig, true>,
    @InjectRepository(Deal)
    private readonly dealRepository: Repository<Deal>,
    private readonly walletSdkService: WalletSdkService,
  ) {
    this.blockchainConfig = this.configService.get("blockchain");
  }

  async onModuleInit(): Promise<void> {
    if (process.env.DEALBOT_DISABLE_CHAIN === "true") {
      this.logger.warn("Chain integration disabled; skipping Synapse initialization for piece cleanup.");
      return;
    }
    try {
      this.logger.log("Initializing shared Synapse instance for piece cleanup.");
      const { synapse } = await createSynapseFromConfig(this.blockchainConfig);
      this.sharedSynapse = synapse;
    } catch (error) {
      this.logger.error({
        event: "piece_cleanup_synapse_init_failed",
        message: "Failed to initialize shared Synapse instance for piece cleanup; will create on demand",
        error: toStructuredError(error),
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.sharedSynapse) {
      this.sharedSynapse = undefined;
    }
  }

  private async createSynapseInstance(): Promise<Synapse> {
    try {
      const { synapse } = await createSynapseFromConfig(this.blockchainConfig);
      return synapse;
    } catch (error) {
      this.logger.error({
        event: "synapse_init_failed",
        message: "Failed to initialize Synapse for piece cleanup",
        error: toStructuredError(error),
      });
      throw error;
    }
  }

  private async awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) {
      return promise;
    }
    signal.throwIfAborted();

    return new Promise<T>((resolve, reject) => {
      const cleanup = () => signal.removeEventListener("abort", onAbort);
      const onAbort = () => {
        cleanup();
        const reason = signal.reason;
        reject(reason instanceof Error ? reason : new Error("Operation aborted"));
      };

      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
    });
  }

  /**
   * Shared quota check: queries provider-reported storage and compares to threshold.
   */
  private async checkProviderQuota(
    spAddress: string,
    signal?: AbortSignal,
  ): Promise<{ isOverQuota: boolean; storedBytes: number; thresholdBytes: number }> {
    const thresholdBytes = this.configService.get("pieceCleanup").maxDatasetStorageSizeBytes;
    const storedBytes = await this.getLiveStoredBytesForProvider(spAddress, signal);
    return { isOverQuota: storedBytes > thresholdBytes, storedBytes, thresholdBytes };
  }

  /**
   * Run cleanup for a single SP.
   * 1. Query provider-reported storage
   * 2. If provider-reported usage > MAX threshold, start cleanup
   * 3. Select oldest completed pieces from DB as deletion candidates
   * 4. For each piece, call deletePiece() via Synapse SDK
   * 5. Mark the deal record as cleaned up
   * 6. Repeat until usage drops below TARGET or runtime cap is reached
   */
  async cleanupPiecesForProvider(
    spAddress: string,
    signal?: AbortSignal,
    logContext?: ProviderJobContext,
  ): Promise<CleanupResult> {
    const { maxDatasetStorageSizeBytes: thresholdBytes, targetDatasetStorageSizeBytes: targetBytes } =
      this.configService.get("pieceCleanup");

    const { storedBytes, isOverQuota } = await this.checkProviderQuota(spAddress, signal);

    const cleanupLogContext: PieceCleanupLogContext = {
      ...logContext,
      providerAddress: spAddress,
      storedBytes,
      thresholdBytes,
      targetBytes,
    };

    if (!isOverQuota) {
      this.logger.debug({
        ...cleanupLogContext,
        event: "piece_cleanup_below_threshold",
        message: "Storage below threshold; skipping cleanup",
      });
      return { deleted: 0, failed: 0, skipped: true, storedBytes, thresholdBytes };
    }

    const excessBytes = storedBytes - targetBytes;
    this.logger.log({
      ...cleanupLogContext,
      event: "piece_cleanup_started",
      message: "Storage exceeds threshold; starting cleanup",
      excessBytes,
    });

    let deleted = 0;
    let failed = 0;
    let bytesRemoved = 0;

    const synapse = this.sharedSynapse ?? (await this.createSynapseInstance());

    // Fetch candidates in batches. Keep deleting until back under quota or runtime cap.
    while (bytesRemoved < excessBytes) {
      signal?.throwIfAborted();

      const candidates = await this.getCleanupCandidates(spAddress, 50);

      if (candidates.length === 0) {
        this.logger.warn({
          ...cleanupLogContext,
          event: "piece_cleanup_no_candidates",
          message: "Above threshold but no more cleanup candidates found",
        });
        break;
      }

      let batchDeletedCount = 0;

      for (const deal of candidates) {
        signal?.throwIfAborted();

        if (bytesRemoved >= excessBytes) {
          this.logger.debug({
            ...cleanupLogContext,
            event: "piece_cleanup_excess_cleared",
            message: "Excess cleared; stopping",
            bytesRemoved,
            excessBytes,
          });
          break;
        }

        try {
          await this.deletePiece(deal, signal, synapse, cleanupLogContext);
          deleted++;
          batchDeletedCount++;
          bytesRemoved += Number(deal.pieceSize || 0);
          this.logger.log({
            ...cleanupLogContext,
            event: "piece_cleanup_piece_deleted",
            message: "Piece deleted",
            dealId: deal.id,
            pieceId: deal.pieceId,
            pieceCid: deal.pieceCid,
            dataSetId: deal.dataSetId,
            pieceSize: deal.pieceSize,
          });
        } catch (error) {
          failed++;
          this.logger.error({
            ...cleanupLogContext,
            event: "piece_cleanup_piece_delete_failed",
            message: "Failed to delete piece",
            dealId: deal.id,
            pieceId: deal.pieceId,
            pieceCid: deal.pieceCid,
            dataSetId: deal.dataSetId,
            error: toStructuredError(error),
          });
          // Continue to next piece
        }
      }

      if (batchDeletedCount === 0) {
        this.logger.warn({
          ...cleanupLogContext,
          event: "piece_cleanup_no_progress",
          message: "No pieces deleted in last batch; stopping to avoid infinite loop",
          failed,
        });
        break;
      }
    }

    this.logger.log({
      ...cleanupLogContext,
      event: "piece_cleanup_completed",
      message: "Cleanup completed",
      deleted,
      failed,
      bytesRemoved,
    });

    return { deleted, failed, skipped: false, storedBytes, thresholdBytes };
  }

  /**
   * Query the provider's actual storage via filecoin-pin.
   */
  async getLiveStoredBytesForProvider(spAddress: string, signal?: AbortSignal): Promise<number> {
    const synapse = this.sharedSynapse ?? (await this.createSynapseInstance());

    const datasets = await this.awaitWithAbort(
      listDataSets(synapse, {
        filter: (ds) => ds.serviceProvider.toLowerCase() === spAddress.toLowerCase(),
      }),
      signal,
    );

    if (datasets.length === 0) {
      this.logger.debug({
        event: "piece_cleanup_no_datasets",
        message: "SP has no datasets",
        providerAddress: spAddress,
      });
      return 0;
    }

    const result = await calculateActualStorage(synapse, datasets, { signal });

    if (result.timedOut) {
      const reason = signal?.reason;
      if (reason instanceof Error) {
        throw reason;
      }
      throw new Error(`Live storage query timed out for provider ${spAddress}`);
    }

    this.logger.debug({
      event: "piece_cleanup_storage_queried",
      providerAddress: spAddress,
      totalBytes: Number(result.totalBytes),
      dataSetCount: result.dataSetCount,
      pieceCount: result.pieceCount,
      timedOut: result.timedOut,
    });

    return Number(result.totalBytes);
  }

  /**
   * Calculate total stored bytes for a provider from the deals table.
   * Only counts completed deals that have not already been cleaned up.
   */
  async getStoredBytesForProvider(spAddress: string): Promise<number> {
    const walletAddress = this.blockchainConfig.walletAddress;
    const result = await this.dealRepository
      .createQueryBuilder("deal")
      .select("COALESCE(SUM(deal.piece_size), 0)", "totalBytes")
      .where("deal.sp_address = :spAddress", { spAddress })
      .andWhere("deal.wallet_address = :walletAddress", { walletAddress })
      .andWhere("deal.status = :status", { status: DealStatus.DEAL_CREATED })
      .andWhere("deal.piece_id IS NOT NULL")
      .andWhere("deal.data_set_id IS NOT NULL")
      .andWhere("deal.cleaned_up = :cleanedUp", { cleanedUp: false })
      .getRawOne<{ totalBytes: string }>();

    return Number(result?.totalBytes ?? 0);
  }

  /**
   * Get the oldest completed deals (candidates for cleanup).
   */
  async getCleanupCandidates(spAddress: string, limit: number): Promise<Deal[]> {
    const walletAddress = this.blockchainConfig.walletAddress;
    return this.dealRepository.find({
      where: {
        spAddress,
        walletAddress,
        status: DealStatus.DEAL_CREATED,
        pieceId: Not(IsNull()),
        dataSetId: Not(IsNull()),
        cleanedUp: false,
      },
      order: { createdAt: "ASC" },
      take: limit,
    });
  }

  /**
   * Delete a single piece via Synapse SDK and mark the deal as cleaned up.
   */
  async deletePiece(
    deal: Deal,
    signal?: AbortSignal,
    existingSynapse?: Synapse,
    logContext?: PieceCleanupLogContext,
  ): Promise<void> {
    if (deal.pieceId == null) {
      throw new Error(`Deal ${deal.id} is missing pieceId`);
    }
    if (deal.dataSetId == null) {
      throw new Error(`Deal ${deal.id} is missing dataSetId`);
    }

    signal?.throwIfAborted();

    const providerId = this.walletSdkService.getProviderInfo(deal.spAddress)?.id;
    if (providerId === undefined) {
      throw new Error(`Provider ID not found for SP address ${deal.spAddress}`);
    }
    const synapse = existingSynapse ?? this.sharedSynapse ?? (await this.createSynapseInstance());
    const storage = await synapse.storage.createContext({
      providerId,
      dataSetId: deal.dataSetId,
    });

    try {
      await storage.deletePiece({ piece: BigInt(deal.pieceId) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Idempotent: treat "piece already gone" contract reverts as success.
      const isAlreadyDeleted =
        message.includes("Can only schedule removal of live pieces") ||
        message.includes("Piece ID already scheduled for removal");

      if (isAlreadyDeleted) {
        this.logger.debug({
          ...logContext,
          event: "piece_cleanup_already_deleted",
          message: "Piece already deleted; treating as success",
          dealId: deal.id,
          pieceId: deal.pieceId,
          providerAddress: deal.spAddress,
        });
      } else {
        throw error;
      }
    }

    // Mark the deal as cleaned up
    deal.cleanedUp = true;
    deal.cleanedUpAt = new Date();
    await this.dealRepository.save(deal);
  }
}
