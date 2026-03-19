import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { CID } from "multiformats/cid";
import type { Repository } from "typeorm";
import { type ProviderJobContext, type RetrievalLogContext, toStructuredError } from "../common/logging.js";
import type { Hex } from "../common/types.js";
import type { IConfig } from "../config/app.config.js";
import { Deal } from "../database/entities/deal.entity.js";
import { Retrieval } from "../database/entities/retrieval.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { DealStatus, RetrievalStatus, ServiceType } from "../database/types.js";
import { IpniVerificationService } from "../ipni/ipni-verification.service.js";
import {
  buildCheckMetricLabels,
  type CheckMetricLabels,
  classifyFailureStatus,
} from "../metrics/utils/check-metric-labels.js";
import { DiscoverabilityCheckMetrics, RetrievalCheckMetrics } from "../metrics/utils/check-metrics.service.js";
import { RetrievalAddonsService } from "../retrieval-addons/retrieval-addons.service.js";
import type {
  RetrievalConfiguration,
  RetrievalExecutionResult,
  RetrievalTestResult,
} from "../retrieval-addons/types.js";

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    private readonly retrievalAddonsService: RetrievalAddonsService,
    @InjectRepository(Deal)
    private readonly dealRepository: Repository<Deal>,
    @InjectRepository(Retrieval)
    private readonly retrievalRepository: Repository<Retrieval>,
    @InjectRepository(StorageProvider)
    private readonly spRepository: Repository<StorageProvider>,
    private readonly retrievalMetrics: RetrievalCheckMetrics,
    private readonly discoverabilityMetrics: DiscoverabilityCheckMetrics,
    private readonly ipniVerificationService: IpniVerificationService,
    private readonly configService: ConfigService<IConfig, true>,
  ) {}

  async performRandomRetrievalForProvider(
    spAddress: string,
    signal?: AbortSignal,
    logContext?: ProviderJobContext,
  ): Promise<Retrieval[]> {
    const deal = await this.selectRandomSuccessfulDealForProvider(spAddress);
    if (!deal) {
      this.logger.warn({
        ...logContext,
        event: "retrieval_job_skipped",
        message: "No successful deals available, skipping retrieval",
      });
      return [];
    }

    this.logger.log({
      ...logContext,
      event: "retrieval_job_started",
      message: "Starting retrieval test",
    });

    return this.performAllRetrievals(deal, signal, logContext);
  }

  async performRetrievalsForDeal(deal: Deal, signal?: AbortSignal): Promise<Retrieval[]> {
    return this.performAllRetrievals(deal, signal);
  }

  // ============================================================================
  // Retrieval Execution
  // ============================================================================

  private async performAllRetrievals(
    deal: Deal,
    signal?: AbortSignal,
    logContext?: ProviderJobContext,
  ): Promise<Retrieval[]> {
    signal?.throwIfAborted();

    const provider = await this.findStorageProvider(deal.spAddress);
    if (!provider) {
      throw new Error(`Storage provider ${deal.spAddress} not found`);
    }
    const providerLabels = buildCheckMetricLabels({
      checkType: "retrieval",
      providerId: provider.providerId,
      providerName: provider.name,
      providerIsApproved: provider.isApproved,
    });
    const retrievalLogContext: RetrievalLogContext = {
      ...logContext,
      jobId: logContext?.jobId,
      dealId: deal.id,
      providerId: provider.providerId ?? logContext?.providerId,
      providerName: provider.name ?? logContext?.providerName,
      providerAddress: deal.spAddress,
      pieceCid: deal.pieceCid,
      ipfsRootCID: deal.metadata?.[ServiceType.IPFS_PIN]?.rootCID,
    };

    const config: RetrievalConfiguration = {
      deal,
      walletAddress: deal.walletAddress as Hex,
      storageProvider: deal.spAddress as Hex,
    };

    const applicableStrategies = this.retrievalAddonsService.getApplicableStrategies(config);
    if (applicableStrategies.length === 0) {
      this.logger.warn({
        ...retrievalLogContext,
        event: "retrieval_job_skipped_no_strategies",
        message: "Retrieval skipped: no applicable retrieval strategies (likely missing IPNI metadata).",
      });
      return [];
    }

    let terminalStatus: "success" | "failure.timedout" | "failure.other" | null = null;
    let retrievals: Retrieval[] = [];
    let caughtError: unknown = null;
    const retrievalCheckStartTime = Date.now();
    // If this throws, we want the job to fail fast: missing/invalid CIDs are an orchestration
    // failure and we should not mark the retrieval as pending for this deal.
    const ipniContext = this.isPgBossMode() ? this.getIpniCidsForRetrieval(deal) : null;
    this.retrievalMetrics.recordStatus(providerLabels, "pending");

    try {
      if (this.isPgBossMode()) {
        const ipniCheck = await this.verifyIpniForRetrieval(
          ipniContext as { rootCid: CID; blockCids: CID[] },
          deal.id,
          provider,
          providerLabels,
          signal,
        );
        if (!ipniCheck.ok) {
          terminalStatus = ipniCheck.failureStatus ?? "failure.other";
        }
      }

      if (!terminalStatus) {
        const testResult: RetrievalTestResult = await this.retrievalAddonsService.testAllRetrievalMethods(
          config,
          signal,
          retrievalLogContext,
        );
        retrievals = await Promise.all(
          testResult.results.map((executionResult) =>
            this.createRetrievalFromResult(deal, executionResult, providerLabels),
          ),
        );

        const successCount = retrievals.filter((r) => r.status === RetrievalStatus.SUCCESS).length;
        this.logger.log({
          ...retrievalLogContext,
          event: "retrievals_completed",
          message: "Retrievals successful",
          successCount,
          totalCount: retrievals.length,
        });

        if (testResult.aborted || signal?.aborted) {
          const abortReason = signal?.reason;
          const abortMessage = abortReason instanceof Error ? abortReason.message : String(abortReason ?? "");
          this.logger.warn({
            ...retrievalLogContext,
            event: "retrieval_job_aborted",
            message: "Retrieval job aborted; recorded partial results.",
            reason: abortMessage || "Unknown",
            error: toStructuredError(abortReason),
          });
          terminalStatus = signal?.aborted ? "failure.timedout" : "failure.other";
        } else {
          terminalStatus = retrievals.every((retrieval) => retrieval.status === RetrievalStatus.SUCCESS)
            ? "success"
            : "failure.other";
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (signal?.aborted) {
        const abortReason = signal.reason;
        const abortMessage = abortReason instanceof Error ? abortReason.message : String(abortReason ?? "");
        this.logger.warn({
          ...retrievalLogContext,
          event: "retrievals_aborted",
          message: "Retrievals aborted",
          reason: abortMessage || errorMessage,
          error: toStructuredError(error),
        });
        terminalStatus = "failure.timedout";
      } else {
        this.logger.error({
          ...retrievalLogContext,
          event: "all_retrievals_failed",
          message: "All retrievals failed",
          error: toStructuredError(error),
        });
        terminalStatus = classifyFailureStatus(error);
      }

      // If this catch block fires, it's either:
      // 1. The job timeout fired (signal aborted) - record failure.timedout once
      // 2. A catastrophic error occurred (provider not found, etc.) - re-throw for logging
      // 3. Individual HTTP timeouts are captured by Promise.allSettled in testAllRetrievalMethods
      //    and converted to FAILED records through the normal flow
      caughtError = error;
    } finally {
      const retrievalCheckDurationMs = Date.now() - retrievalCheckStartTime;
      this.retrievalMetrics.observeCheckDuration(providerLabels, retrievalCheckDurationMs);
      if (terminalStatus) {
        this.retrievalMetrics.recordStatus(providerLabels, terminalStatus);
      }
    }

    if (!terminalStatus) {
      const message = `Missing terminal retrieval status for deal ${deal.id} (${deal.pieceCid ?? "unknown pieceCid"})`;
      this.logger.error({
        ...retrievalLogContext,
        event: "retrieval_missing_terminal_status",
        message,
      });
      throw new Error(message);
    }

    if (caughtError) {
      throw caughtError;
    }

    return retrievals;
  }

  private async createRetrievalFromResult(
    deal: Deal,
    executionResult: RetrievalExecutionResult,
    providerLabels: CheckMetricLabels,
  ): Promise<Retrieval> {
    const retrieval = this.retrievalRepository.create({
      dealId: deal.id,
      status: executionResult.success ? RetrievalStatus.SUCCESS : RetrievalStatus.FAILED,
      retrievalEndpoint: executionResult.url || "N/A",
      serviceType: executionResult.method,
    });

    if (executionResult.success) {
      this.mapExecutionResultToRetrieval(retrieval, executionResult);
      this.recordRetrievalEventMetrics(executionResult, providerLabels);
    } else {
      retrieval.completedAt = new Date();
      retrieval.startedAt = new Date();
      retrieval.errorMessage = executionResult.error || "Unknown error";
      this.retrievalMetrics.recordHttpResponseCode(providerLabels, executionResult.metrics.statusCode);
    }

    return this.saveRetrieval(retrieval);
  }

  private recordRetrievalEventMetrics(
    executionResult: RetrievalExecutionResult,
    providerLabels: CheckMetricLabels,
  ): void {
    if (!executionResult.success) return;

    this.retrievalMetrics.observeFirstByteMs(providerLabels, executionResult.metrics.ttfb);
    this.retrievalMetrics.observeLastByteMs(providerLabels, executionResult.metrics.latency);
    this.retrievalMetrics.observeThroughput(providerLabels, executionResult.metrics.throughput);
    if (executionResult.validation?.blockTtfbMs) {
      for (const ttfb of executionResult.validation.blockTtfbMs) {
        this.retrievalMetrics.observeBlockFirstByteMs(providerLabels, ttfb);
      }
    }
    this.retrievalMetrics.recordHttpResponseCode(providerLabels, executionResult.metrics.statusCode);
  }

  // ============================================================================
  // Retrieval Helpers
  // ============================================================================

  private mapExecutionResultToRetrieval(retrieval: Retrieval, executionResult: RetrievalExecutionResult): void {
    retrieval.startedAt = executionResult.metrics.timestamp;
    retrieval.completedAt = executionResult.metrics.timestamp;
    retrieval.latencyMs = Math.round(executionResult.metrics.latency);
    retrieval.ttfbMs = Math.round(executionResult.metrics.ttfb);
    retrieval.responseCode = executionResult.metrics.statusCode;
    retrieval.bytesRetrieved = executionResult.metrics.responseSize;
    retrieval.throughputBps = Math.round(executionResult.metrics.throughput);
    retrieval.retryCount = executionResult.retryCount || 0;
  }

  private async saveRetrieval(retrieval: Retrieval): Promise<Retrieval> {
    try {
      return await this.retrievalRepository.save(retrieval);
    } catch (error) {
      this.logger.warn({
        event: "save_retrieval_failed",
        message: "Failed to save retrieval",
        retrievalId: retrieval.id,
        dealId: retrieval.dealId,
        error: toStructuredError(error),
      });
      return retrieval;
    }
  }

  private async findStorageProvider(address: string): Promise<StorageProvider | null> {
    return this.spRepository.findOne({ where: { address } });
  }

  /**
   * We select a random successful deal (DEAL_CREATED only) for a given provider.
   * Uses Postgres ORDER BY RANDOM() since Dealbot is Postgres-only.
   */
  private async selectRandomSuccessfulDealForProvider(spAddress: string): Promise<Deal | null> {
    const randomDatasetSizes = this.getRandomDatasetSizes();
    const query = this.dealRepository
      .createQueryBuilder("deal")
      .innerJoin("deal.storageProvider", "sp", "sp.isActive = :isActive", { isActive: true })
      .where("deal.sp_address = :spAddress", { spAddress })
      .andWhere("deal.status IN (:...statuses)", {
        statuses: [DealStatus.DEAL_CREATED],
      })
      .andWhere("deal.metadata -> 'ipfs_pin' ->> 'enabled' = 'true'")
      .andWhere("deal.metadata -> 'ipfs_pin' ->> 'rootCID' IS NOT NULL");
    if (randomDatasetSizes.length > 0) {
      query.andWhere("(deal.metadata -> 'ipfs_pin' ->> 'originalSize')::bigint IN (:...sizes)", {
        sizes: randomDatasetSizes,
      });
    }
    return query.orderBy("RANDOM()").limit(1).getOne();
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private isPgBossMode(): boolean {
    const runMode = this.configService.get("app", { infer: true }).runMode;
    const pgbossSchedulerEnabled = this.configService.get("jobs", { infer: true }).pgbossSchedulerEnabled;

    const workersEnabled = runMode === "worker" || runMode === "both";
    const schedulerEnabled = (runMode === "api" || runMode === "both") && pgbossSchedulerEnabled;

    return workersEnabled || schedulerEnabled;
  }

  private getRandomDatasetSizes(): number[] {
    return this.configService.get("dataset")?.randomDatasetSizes ?? [];
  }

  private getIpniCidsForRetrieval(deal: Deal): { rootCid: CID; blockCids: CID[] } {
    const ipniMetadata = deal.metadata?.[ServiceType.IPFS_PIN];
    if (!ipniMetadata?.rootCID) {
      throw new Error(`Retrieval IPNI verification failed: missing root CID for deal ${deal.id}`);
    }
    if (!ipniMetadata.blockCIDs || ipniMetadata.blockCIDs.length === 0) {
      throw new Error(`Retrieval IPNI verification failed: missing block CIDs for deal ${deal.id}`);
    }

    let rootCid: CID;
    try {
      rootCid = CID.parse(ipniMetadata.rootCID);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Retrieval IPNI verification failed: invalid root CID for deal ${deal.id}: ${errorMessage}`);
    }

    const blockCids: CID[] = ipniMetadata.blockCIDs.map((cid) => {
      try {
        return CID.parse(cid);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Retrieval IPNI verification failed: invalid block CID for deal ${deal.id}: ${errorMessage}`);
      }
    });

    return { rootCid, blockCids };
  }

  private async verifyIpniForRetrieval(
    ipniContext: { rootCid: CID; blockCids: CID[] },
    dealId: string,
    provider: StorageProvider,
    providerLabels: CheckMetricLabels,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; failureStatus?: "failure.timedout" | "failure.other" }> {
    const { rootCid, blockCids } = ipniContext;

    const timeouts = this.configService.get("timeouts");
    const timeoutMs = timeouts.ipniVerificationTimeoutMs;
    const pollIntervalMs = timeouts.ipniVerificationPollingMs;
    this.discoverabilityMetrics.recordStatus(providerLabels, "pending");

    try {
      const ipniResult = await this.ipniVerificationService.verify({
        rootCid,
        blockCids,
        storageProvider: provider,
        timeoutMs,
        pollIntervalMs,
        signal,
      });

      this.discoverabilityMetrics.observeIpniVerifyMs(providerLabels, ipniResult.durationMs);

      if (ipniResult.rootCIDVerified) {
        this.discoverabilityMetrics.recordStatus(providerLabels, "success");
        return { ok: true };
      }
      const failureStatus = ipniResult.durationMs >= timeoutMs ? "failure.timedout" : "failure.other";
      this.discoverabilityMetrics.recordStatus(providerLabels, failureStatus);
      return { ok: false, failureStatus };
    } catch (error) {
      if (signal?.aborted) {
        const failureStatus = "failure.timedout";
        this.discoverabilityMetrics.recordStatus(providerLabels, failureStatus);
        return { ok: false, failureStatus };
      }
      const failureStatus = classifyFailureStatus(error);
      this.logger.warn({
        event: "retrieval_ipni_verification_failed",
        message: "Retrieval IPNI verification failed",
        dealId,
        providerId: provider.providerId,
        providerName: provider.name,
        providerAddress: provider.address,
        ipfsRootCID: ipniContext.rootCid.toString(),
        error: toStructuredError(error),
      });
      this.discoverabilityMetrics.recordStatus(providerLabels, failureStatus);
      return { ok: false, failureStatus };
    }
  }
}
