import { calibration, mainnet, Synapse } from "@filoz/synapse-sdk";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { calculateActualStorage, listDataSets } from "filecoin-pin/core/data-set";
import { IsNull, Not, Repository } from "typeorm";
import { privateKeyToAccount } from "viem/accounts";
import { toStructuredError } from "../common/logging.js";
import type { IBlockchainConfig, IConfig } from "../config/app.config.js";
import { Deal } from "../database/entities/deal.entity.js";
import { DealStatus } from "../database/types.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";

export type StorageContext = Awaited<ReturnType<Synapse["storage"]["createContext"]>>;

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
      this.sharedSynapse = this.createSynapseInstance();
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

  private createSynapseInstance(): Synapse {
    try {
      return Synapse.create({
        account: privateKeyToAccount(this.blockchainConfig.walletPrivateKey),
        chain: this.blockchainConfig.network === "mainnet" ? mainnet : calibration,
        source: "dealbot",
      });
    } catch (error) {
      this.logger.error({
        event: "synapse_init_failed",
        message: "Failed to initialize Synapse for piece cleanup",
        error: toStructuredError(error),
      });
      throw error;
    }
  }

  /**
   * Check whether a provider is over the configured storage quota.
   * Uses live data from the provider with DB fallback.
   * Used by the deal handler to gate new deal creation.
   */
  async isProviderOverQuota(spAddress: string): Promise<boolean> {
    const thresholdBytes = this.configService.get("pieceCleanup").maxDatasetStorageSizeBytes;
    try {
      const liveBytes = await this.getLiveStoredBytesForProvider(spAddress);
      return liveBytes > thresholdBytes;
    } catch (error) {
      this.logger.warn({
        event: "piece_cleanup_live_query_failed",
        message: `Failed to query live storage for SP ${spAddress}; falling back to DB`,
        spAddress,
        error: toStructuredError(error),
      });
      const storedBytes = await this.getStoredBytesForProvider(spAddress);
      return storedBytes > thresholdBytes;
    }
  }

  /**
   * Run cleanup for a single SP.
   * 1. Query live storage (falls back to DB if unavailable)
   * 2. If live usage > MAX threshold, start cleanup
   * 3. Select oldest completed pieces from DB as deletion candidates
   * 4. For each piece, call deletePiece() via Synapse SDK
   * 5. Mark the deal record as cleaned up
   * 6. Repeat until usage drops below TARGET or runtime cap is reached
   */
  async cleanupPiecesForProvider(spAddress: string, signal?: AbortSignal): Promise<CleanupResult> {
    const { maxDatasetStorageSizeBytes: thresholdBytes, targetDatasetStorageSizeBytes: targetBytes } =
      this.configService.get("pieceCleanup");

    let storedBytes: number;
    try {
      storedBytes = await this.getLiveStoredBytesForProvider(spAddress);
    } catch (error) {
      this.logger.warn({
        event: "piece_cleanup_live_query_failed",
        message: `Failed to query live storage for SP ${spAddress}; falling back to DB`,
        spAddress,
        error: toStructuredError(error),
      });
      storedBytes = await this.getStoredBytesForProvider(spAddress);
    }

    if (storedBytes <= thresholdBytes) {
      this.logger.debug({
        event: "piece_cleanup_below_threshold",
        message: `SP ${spAddress}: ${this.formatBytes(storedBytes)} stored, threshold ${this.formatBytes(thresholdBytes)}; skipping cleanup`,
        spAddress,
        storedBytes,
        thresholdBytes,
      });
      return { deleted: 0, failed: 0, skipped: true, storedBytes, thresholdBytes };
    }

    const excessBytes = storedBytes - targetBytes;
    this.logger.log({
      event: "piece_cleanup_started",
      message: `SP ${spAddress}: ${this.formatBytes(storedBytes)} stored exceeds threshold ${this.formatBytes(thresholdBytes)} by ${this.formatBytes(excessBytes)}; starting cleanup`,
      spAddress,
      storedBytes,
      thresholdBytes,
      excessBytes,
    });

    let deleted = 0;
    let failed = 0;
    let bytesRemoved = 0;

    const synapse = this.sharedSynapse ?? this.createSynapseInstance();
    const providerId = this.walletSdkService.getProviderInfo(spAddress)?.id;
    if (providerId === undefined) {
      throw new Error(`Provider ID not found for SP address ${spAddress}`);
    }
    const storage = await synapse.storage.createContext({
      providerId,
    });

    // Fetch candidates in batches. Keep deleting until back under quota or runtime cap.
    while (bytesRemoved < excessBytes) {
      signal?.throwIfAborted();

      const candidates = await this.getCleanupCandidates(spAddress, 50);

      if (candidates.length === 0) {
        this.logger.warn({
          event: "piece_cleanup_no_candidates",
          message: `SP ${spAddress}: above threshold but no more cleanup candidates found`,
          spAddress,
        });
        break;
      }

      let batchDeletedCount = 0;

      for (const deal of candidates) {
        signal?.throwIfAborted();

        if (bytesRemoved >= excessBytes) {
          this.logger.debug({
            event: "piece_cleanup_excess_cleared",
            message: `SP ${spAddress}: removed ${this.formatBytes(bytesRemoved)} which clears the excess; stopping`,
            spAddress,
            bytesRemoved,
            excessBytes,
          });
          break;
        }

        try {
          await this.deletePiece(deal, signal, storage);
          deleted++;
          batchDeletedCount++;
          bytesRemoved += Number(deal.pieceSize || 0);
          this.logger.log({
            event: "piece_cleanup_piece_deleted",
            message: `Deleted piece ${deal.pieceId} (pieceCid: ${deal.pieceCid}) from SP ${spAddress}`,
            spAddress,
            dealId: deal.id,
            pieceId: deal.pieceId,
            pieceCid: deal.pieceCid,
            dataSetId: deal.dataSetId,
            pieceSize: deal.pieceSize,
          });
        } catch (error) {
          failed++;
          this.logger.error({
            event: "piece_cleanup_piece_delete_failed",
            message: `Failed to delete piece ${deal.pieceId} from SP ${spAddress}`,
            spAddress,
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
          event: "piece_cleanup_no_progress",
          message: `SP ${spAddress}: no pieces were deleted in the last batch; stopping to avoid infinite loop`,
          spAddress,
          failed,
        });
        break;
      }
    }

    this.logger.log({
      event: "piece_cleanup_completed",
      message: `SP ${spAddress}: cleanup completed — ${deleted} deleted, ${failed} failed, ${this.formatBytes(bytesRemoved)} freed`,
      spAddress,
      deleted,
      failed,
      bytesRemoved,
      storedBytes,
      thresholdBytes,
    });

    return { deleted, failed, skipped: false, storedBytes, thresholdBytes };
  }

  /**
   * Query the provider's actual live storage via filecoin-pin.
   */
  async getLiveStoredBytesForProvider(spAddress: string, signal?: AbortSignal): Promise<number> {
    const synapse = this.sharedSynapse ?? this.createSynapseInstance();

    const datasets = await listDataSets(synapse, {
      filter: (ds) => ds.serviceProvider === spAddress,
    });

    if (datasets.length === 0) {
      this.logger.debug({
        event: "piece_cleanup_no_live_datasets",
        message: `SP ${spAddress}: no live datasets found on provider`,
        spAddress,
      });
      return 0;
    }

    const result = await calculateActualStorage(synapse, datasets, { signal });

    this.logger.debug({
      event: "piece_cleanup_live_storage_queried",
      message: `SP ${spAddress}: live storage = ${this.formatBytes(Number(result.totalBytes))} across ${result.dataSetCount} datasets (${result.pieceCount} pieces)`,
      spAddress,
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
    const result = await this.dealRepository
      .createQueryBuilder("deal")
      .select("COALESCE(SUM(deal.piece_size), 0)", "totalBytes")
      .where("deal.sp_address = :spAddress", { spAddress })
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
    return this.dealRepository.find({
      where: {
        spAddress,
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
  async deletePiece(deal: Deal, signal?: AbortSignal, existingStorage?: StorageContext): Promise<void> {
    if (deal.pieceId == null) {
      throw new Error(`Deal ${deal.id} is missing pieceId`);
    }

    signal?.throwIfAborted();

    const providerId = this.walletSdkService.getProviderInfo(deal.spAddress)?.id;
    if (providerId === undefined) {
      throw new Error(`Provider ID not found for SP address ${deal.spAddress}`);
    }
    const storage =
      existingStorage ??
      (await (this.sharedSynapse ?? this.createSynapseInstance()).storage.createContext({
        providerId,
      }));

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
          event: "piece_cleanup_already_deleted",
          message: `Piece ${deal.pieceId} on SP ${deal.spAddress} already deleted; treating as success`,
          dealId: deal.id,
          pieceId: deal.pieceId,
          spAddress: deal.spAddress,
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

  private formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  }
}
