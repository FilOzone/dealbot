import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { CID } from "multiformats/cid";
import type { Repository } from "typeorm";
import { ClickhouseService } from "../clickhouse/clickhouse.service.js";
import { type ProviderJobContext, type RetrievalLogContext, toStructuredError } from "../common/logging.js";
import type { Hex, Network } from "../common/types.js";
import type { IConfig } from "../config/index.js";
import { Deal } from "../database/entities/deal.entity.js";
import { Retrieval } from "../database/entities/retrieval.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { DealStatus, RetrievalStatus, ServiceType } from "../database/types.js";
import { DatasetLivenessService } from "../dataset-liveness/dataset-liveness.service.js";
import { IpniVerificationService } from "../ipni/ipni-verification.service.js";
import {
  buildCheckMetricLabels,
  type CheckMetricLabels,
  classifyFailureStatus,
} from "../metrics-prometheus/check-metric-labels.js";
import {
  classifyIpniVerifyOutcome,
  DiscoverabilityCheckMetrics,
  RetrievalCheckMetrics,
} from "../metrics-prometheus/check-metrics.service.js";
import { RetrievalAddonsService } from "../retrieval-addons/retrieval-addons.service.js";
import type {
  RetrievalConfiguration,
  RetrievalExecutionResult,
  RetrievalTestResult,
} from "../retrieval-addons/types.js";

/** Timeout for the pre-flight SP piece-status probe. Short enough that an unresponsive
 *  SP still beats falling through to the 30s IPNI verify path; on timeout we treat
 *  the result as "unknown" and proceed with the normal retrieval. */
const SP_PIECE_STATUS_PROBE_TIMEOUT_MS = 5_000;

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
    private readonly clickhouseService: ClickhouseService,
    private readonly datasetLivenessService: DatasetLivenessService,
  ) {}

  async performRandomRetrievalForProvider(
    spAddress: string,
    network: Network,
    signal?: AbortSignal,
    logContext?: ProviderJobContext,
  ): Promise<Retrieval[]> {
    const deal = await this.selectRandomSuccessfulDealForProvider(spAddress, network);
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

    const provider = await this.findStorageProvider(deal.spAddress, deal.network);
    if (!provider) {
      throw new Error(`Storage provider ${deal.spAddress} not found on network ${deal.network}`);
    }
    const providerLabels = buildCheckMetricLabels({
      checkType: "retrieval",
      network: deal.network,
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

    // Pre-check pipeline before any retrieval work. Requires `deal.dataSetId`
    // and `deal.pieceId` to be populated (DealService writes them in the
    // upload event handler).
    //
    //   1. Chain `pieceLive(dataSetId, pieceId)`: source of truth for whether
    //      the SP is still expected to retain this piece. If false (dataset
    //      terminated, piece never created, or piece hard-removed), mark the
    //      deal cleaned_up + skip. No SP probe needed in this case.
    //   2. SP HTTP GET `/pdp/piece/:pieceCid/status`: cheap health-check that
    //      the SP can actually serve. 404 here when chain says the piece
    //      should be live = real SP-side failure. Recorded as a failed
    //      retrieval row (deal stays in the candidate pool so the scheduler
    //      re-probes; persistent failures become observable on dashboards).
    if (deal.dataSetId == null || deal.pieceId == null) {
      // Bail loudly so the row is fixed before it pollutes downstream metrics.
      this.retrievalMetrics.recordStatus(providerLabels, "failure.other");
      this.logger.error({
        ...retrievalLogContext,
        event: "retrieval_missing_chain_ids",
        message: "Deal is missing dataSetId or pieceId; cannot run chain pre-check. Backfill required.",
        dataSetId: deal.dataSetId?.toString() ?? null,
        pieceId: deal.pieceId ?? null,
      });
      return [];
    }

    const pieceLive = await this.checkPieceLive(
      deal.dataSetId,
      BigInt(deal.pieceId),
      deal.network,
      signal,
      retrievalLogContext,
    );
    signal?.throwIfAborted();
    if (!pieceLive) {
      const updateResult = await this.dealRepository.update(
        { id: deal.id, cleanedUp: false },
        { cleanedUp: true, cleanedUpAt: new Date() },
      );
      this.retrievalMetrics.recordStatus(providerLabels, "skipped.piece_missing");
      this.logger.warn({
        ...retrievalLogContext,
        event: "retrieval_skipped_piece_missing",
        message: "PDP pieceLive=false; marked deal cleaned_up and skipped retrieval",
        dataSetId: deal.dataSetId.toString(),
        pieceId: deal.pieceId,
        affected: updateResult.affected ?? 0,
      });
      return [];
    }

    if (provider.serviceUrl && deal.pieceCid) {
      const probe = await this.probeSpPieceStatus(provider.serviceUrl, deal.pieceCid, signal);
      signal?.throwIfAborted();
      if (probe.result === "missing") {
        // Chain pre-check above confirmed the piece SHOULD be retrievable.
        // SP 404 here is an SP-side failure to honor its storage commitment.
        this.retrievalMetrics.recordStatus(providerLabels, "failure.other");
        const now = new Date();
        const startedAt = new Date(now.getTime() - probe.durationMs);
        const failed = this.retrievalRepository.create({
          deal,
          serviceType: ServiceType.IPFS_PIN,
          retrievalEndpoint: probe.url,
          status: RetrievalStatus.FAILED,
          startedAt,
          completedAt: now,
          latencyMs: probe.durationMs,
          responseCode: probe.statusCode ?? null,
          errorMessage: "SP reports piece missing but PDP pieceLive=true",
          retryCount: 0,
        } as Partial<Retrieval>);
        const saved = await this.retrievalRepository.save(failed);
        this.logger.warn({
          ...retrievalLogContext,
          event: "retrieval_failed_piece_missing_live",
          message: "SP reports piece missing while chain reports pieceLive=true; recorded failed retrieval",
          statusUrl: probe.url,
          statusCode: probe.statusCode,
          probeDurationMs: probe.durationMs,
        });
        return [saved];
      }
    }

    type SubStatus = "success" | "failure.timedout" | "failure.other";
    let terminalStatus: SubStatus | null = null;
    let retrievals: Retrieval[] = [];
    let caughtError: unknown = null;
    const retrievalCheckStartTime = Date.now();
    // If this throws, we want the job to fail fast: missing/invalid CIDs are an orchestration
    // failure and we should not mark the retrieval as pending for this deal.
    const ipniContext = this.isPgBossMode() ? this.getIpniCidsForRetrieval(deal) : null;
    this.retrievalMetrics.recordStatus(providerLabels, "pending");

    try {
      const transportPromise = this.runTransport(deal, config, providerLabels, retrievalLogContext, signal);
      const ipniPromise = this.isPgBossMode()
        ? this.verifyIpniForRetrieval(
            ipniContext as { rootCid: CID; blockCids: CID[] },
            deal.id,
            provider,
            providerLabels,
            signal,
          )
        : Promise.resolve({ ok: true as const });

      const [transportSettled, ipniSettled] = await Promise.allSettled([transportPromise, ipniPromise]);

      if (transportSettled.status === "fulfilled") {
        retrievals = transportSettled.value.retrievals;
      } else {
        caughtError = transportSettled.reason;
      }

      if (ipniSettled.status === "rejected") {
        // verifyIpniForRetrieval already catches and records discoverabilityStatus.
        // A rejection here is unexpected; log but do not affect retrievalStatus.
        this.logger.warn({
          ...retrievalLogContext,
          event: "retrieval_ipni_unexpected_rejection",
          message: "IPNI verification promise rejected unexpectedly",
          error: toStructuredError(ipniSettled.reason),
        });
      }

      // retrievalStatus is scoped to the transport stage (ipfsRetrievalIntegrityChecked).
      // IPNI outcomes are recorded independently via discoverabilityStatus.
      terminalStatus = this.classifyTransportOutcome(transportSettled, signal);
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

  private async runTransport(
    deal: Deal,
    config: RetrievalConfiguration,
    providerLabels: CheckMetricLabels,
    retrievalLogContext: RetrievalLogContext,
    signal?: AbortSignal,
  ): Promise<{ retrievals: Retrieval[]; aborted: boolean; allSuccess: boolean }> {
    try {
      const testResult: RetrievalTestResult = await this.retrievalAddonsService.testAllRetrievalMethods(
        config,
        signal,
        retrievalLogContext,
      );
      const retrievals = await Promise.all(
        testResult.results.map((executionResult) =>
          this.createRetrievalFromResult(deal, executionResult, providerLabels),
        ),
      );

      const successCount = retrievals.filter((r) => r.status === RetrievalStatus.SUCCESS).length;
      const allSuccess = successCount === retrievals.length;
      this.logger.log({
        ...retrievalLogContext,
        event: "retrievals_completed",
        message: allSuccess ? "All retrievals succeeded" : "Retrievals completed with failures",
        successCount,
        totalCount: retrievals.length,
        allSuccess,
      });

      const aborted = Boolean(testResult.aborted) || Boolean(signal?.aborted);
      if (aborted) {
        const abortReason = signal?.reason;
        const abortMessage = abortReason instanceof Error ? abortReason.message : String(abortReason ?? "");
        this.logger.warn({
          ...retrievalLogContext,
          event: "retrieval_job_aborted",
          message: "Retrieval job aborted; recorded partial results.",
          reason: abortMessage || "Unknown",
          error: toStructuredError(abortReason),
        });
      }

      return {
        retrievals,
        aborted,
        allSuccess: retrievals.every((r) => r.status === RetrievalStatus.SUCCESS),
      };
    } catch (error) {
      if (signal?.aborted) {
        const abortReason = signal.reason;
        const errorMessage = error instanceof Error ? error.message : String(error);
        const abortMessage = abortReason instanceof Error ? abortReason.message : String(abortReason ?? "");
        this.logger.warn({
          ...retrievalLogContext,
          event: "retrievals_aborted",
          message: "Retrievals aborted",
          reason: abortMessage || errorMessage,
          error: toStructuredError(error),
        });
      } else {
        this.logger.error({
          ...retrievalLogContext,
          event: "all_retrievals_failed",
          message: "All retrievals failed",
          error: toStructuredError(error),
        });
      }
      throw error;
    }
  }

  private classifyTransportOutcome(
    settled: PromiseSettledResult<{ retrievals: Retrieval[]; aborted: boolean; allSuccess: boolean }>,
    signal?: AbortSignal,
  ): "success" | "failure.timedout" | "failure.other" {
    if (settled.status === "rejected") {
      return signal?.aborted ? "failure.timedout" : classifyFailureStatus(settled.reason);
    }
    if (settled.value.aborted) return "failure.timedout";
    return settled.value.allSuccess ? "success" : "failure.other";
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

    const saved = await this.saveRetrieval(retrieval);

    this.clickhouseService.insert("retrieval_checks", {
      timestamp: Date.now(),
      probe_location: this.clickhouseService.probeLocation,
      sp_address: deal.spAddress,
      sp_id: providerLabels.providerId !== "unknown" ? providerLabels.providerId : null,
      sp_name: providerLabels.providerName !== "unknown" ? providerLabels.providerName : null,
      deal_id: deal.id,
      retrieval_id: saved.id,
      service_type: saved.serviceType,
      status: saved.status,
      http_response_code: executionResult.metrics.statusCode || null,
      first_byte_ms: executionResult.success ? executionResult.metrics.ttfb : null,
      last_byte_ms: executionResult.success ? executionResult.metrics.latency : null,
      bytes_retrieved: executionResult.success ? executionResult.metrics.responseSize : null,
    });

    return saved;
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

  private async findStorageProvider(address: string, network: Network): Promise<StorageProvider | null> {
    return this.spRepository.findOne({ where: { address, network } });
  }

  /**
   * Probe `${serviceUrl}/pdp/piece/:pieceCid/status` to determine whether the SP
   * currently has the piece. Returns:
   *   - "missing": SP responded 404 (authoritative — SP does not have the piece)
   *   - "exists": SP responded 2xx (piece is held)
   *   - "unknown": network error, probe timeout, or other status (don't act on it)
   * An outer-signal abort during the probe is re-thrown so the caller can stop.
   */
  private async probeSpPieceStatus(
    serviceUrl: string,
    pieceCid: string,
    outerSignal?: AbortSignal,
  ): Promise<{ result: "missing" | "exists" | "unknown"; url: string; statusCode: number | null; durationMs: number }> {
    const url = `${serviceUrl.replace(/\/$/, "")}/pdp/piece/${encodeURIComponent(pieceCid)}/status`;
    const timeoutSignal = AbortSignal.timeout(SP_PIECE_STATUS_PROBE_TIMEOUT_MS);
    const signal = outerSignal ? AbortSignal.any([outerSignal, timeoutSignal]) : timeoutSignal;
    const start = Date.now();
    try {
      // Curio chi router does not register HEAD for /pdp/piece/{cid}/status (returns 405)
      // and ignores Range headers. Body is a small JSON status payload (<500B), so just
      // GET and drop the body without reading it.
      const res = await fetch(url, {
        method: "GET",
        signal,
        headers: { "User-Agent": "dealbot/probe" },
      });
      await res.body?.cancel().catch(() => undefined);
      const durationMs = Date.now() - start;
      if (res.status === 404) return { result: "missing", url, statusCode: 404, durationMs };
      if (res.ok) return { result: "exists", url, statusCode: res.status, durationMs };
      return { result: "unknown", url, statusCode: res.status, durationMs };
    } catch (error) {
      // Re-throw caller-initiated aborts so retrieval stops promptly. Probe-timeout
      // and network errors fall through as "unknown" — we don't want to mark deals
      // cleaned_up on flaky infra.
      if (outerSignal?.aborted) {
        throw error;
      }
      return { result: "unknown", url, statusCode: null, durationMs: Date.now() - start };
    }
  }

  /**
   * We select a successful deal (DEAL_CREATED only) for a given provider, preferring
   * deals with the fewest prior ipfs_pin retrievals (ties broken randomly). This
   * guarantees every eligible deal is retrieved once before any deal is retrieved
   * twice, keeping coverage uniform regardless of pool size.
   */
  private async selectRandomSuccessfulDealForProvider(spAddress: string, network: Network): Promise<Deal | null> {
    const walletAddress = this.configService.get("networks", { infer: true })[network].walletAddress;

    const randomDatasetSizes = this.getRandomDatasetSizes();
    const query = this.dealRepository
      .createQueryBuilder("deal")
      .innerJoin("deal.storageProvider", "sp", "sp.isActive = :isActive", { isActive: true })
      .where("deal.sp_address = :spAddress", { spAddress })
      .andWhere("deal.network = :network", { network })
      .andWhere("deal.wallet_address = :walletAddress", { walletAddress })
      .andWhere("deal.status IN (:...statuses)", {
        statuses: [DealStatus.DEAL_CREATED],
      })
      .andWhere("deal.metadata -> 'ipfs_pin' ->> 'enabled' = 'true'")
      .andWhere("deal.metadata -> 'ipfs_pin' ->> 'rootCID' IS NOT NULL")
      .andWhere("deal.cleaned_up = :cleanedUp", { cleanedUp: false });
    if (randomDatasetSizes.length > 0) {
      query.andWhere("(deal.metadata -> 'ipfs_pin' ->> 'originalSize')::bigint IN (:...sizes)", {
        sizes: randomDatasetSizes,
      });
    }
    return query
      .orderBy(`(SELECT COUNT(*) FROM retrievals r WHERE r.deal_id = deal.id AND r.service_type = 'ipfs_pin')`, "ASC")
      .addOrderBy("RANDOM()")
      .limit(1)
      .getOne();
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

    const ipniVerifyStartMs = Date.now();
    try {
      const ipniResult = await this.ipniVerificationService.verify({
        rootCid,
        blockCids,
        storageProvider: provider,
        timeoutMs,
        pollIntervalMs,
        signal,
      });

      this.discoverabilityMetrics.observeIpniVerifyMs(
        providerLabels,
        ipniResult.durationMs,
        classifyIpniVerifyOutcome(ipniResult, timeoutMs),
        "filecoinpin.contact",
      );

      if (ipniResult.rootCIDVerified) {
        this.discoverabilityMetrics.recordStatus(providerLabels, "success");
        return { ok: true };
      }
      const failureStatus = ipniResult.durationMs >= timeoutMs ? "failure.timedout" : "failure.other";
      this.discoverabilityMetrics.recordStatus(providerLabels, failureStatus);
      return { ok: false, failureStatus };
    } catch (error) {
      const durationMs = Date.now() - ipniVerifyStartMs;
      if (signal?.aborted) {
        const failureStatus = "failure.timedout";
        this.logger.warn({
          event: "retrieval_ipni_verification_timed_out",
          message: "Retrieval IPNI verification aborted by outer job timeout",
          dealId,
          providerId: provider.providerId,
          providerName: provider.name,
          providerAddress: provider.address,
          ipfsRootCID: ipniContext.rootCid.toString(),
          error: toStructuredError(error),
        });
        this.discoverabilityMetrics.observeIpniVerifyMs(
          providerLabels,
          durationMs,
          "failure.timedout",
          "filecoinpin.contact",
        );
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
      this.discoverabilityMetrics.observeIpniVerifyMs(
        providerLabels,
        durationMs,
        "failure.other",
        "filecoinpin.contact",
      );
      this.discoverabilityMetrics.recordStatus(providerLabels, failureStatus);
      return { ok: false, failureStatus };
    }
  }

  /**
   * Defensive wrapper around `DatasetLivenessService.isPieceLive` used by the
   * retrieval pre-check. On RPC failure, return `true` (treat as live) so a
   * transient chain outage does NOT cascade into bulk cleanups. The downstream
   * SP probe + retrieval fetch will surface the real outcome instead.
   */
  private async checkPieceLive(
    dataSetId: bigint,
    pieceId: bigint,
    network: Network,
    signal: AbortSignal | undefined,
    logContext: RetrievalLogContext,
  ): Promise<boolean> {
    try {
      return await this.datasetLivenessService.isPieceLive(dataSetId, pieceId, network, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      this.logger.warn({
        ...logContext,
        event: "retrieval_piece_liveness_probe_failed",
        message: "PDP pieceLive probe failed; treating piece as live to avoid spurious cleanup",
        dataSetId: dataSetId.toString(),
        pieceId: pieceId.toString(),
        error: toStructuredError(error),
      });
      return true;
    }
  }
}
