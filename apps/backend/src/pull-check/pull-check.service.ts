import * as crypto from "node:crypto";
import { Readable } from "node:stream";
import { calculate, calculateFromIterable, parse as parsePieceCid } from "@filoz/synapse-core/piece";
import { pullPieces, waitForPullStatus } from "@filoz/synapse-core/sp";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Account, Address, Chain, Client, Transport } from "viem";
import { type ProviderJobContext, toStructuredError } from "../common/logging.js";
import type { IAppConfig, IConfig, IPullPieceConfig } from "../config/app.config.js";
import { DataSourceService } from "../dataSource/dataSource.service.js";
import { HttpClientService } from "../http-client/http-client.service.js";
import { buildCheckMetricLabels, classifyFailureStatus } from "../metrics-prometheus/check-metric-labels.js";
import { PullCheckCheckMetrics } from "../metrics-prometheus/check-metrics.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { PDPProviderEx } from "../wallet-sdk/wallet-sdk.types.js";
import type { PullPiecePrepared, PullPieceRegistration } from "./pull-check.types.js";
import { PullPieceRepository } from "./pull-piece.repository.js";

type SynapseViemClient = Client<Transport, Chain, Account>;

@Injectable()
export class PullCheckService {
  private readonly logger = new Logger(PullCheckService.name);

  constructor(
    private readonly configService: ConfigService<IConfig, true>,
    private readonly walletSdkService: WalletSdkService,
    private readonly dataSourceService: DataSourceService,
    private readonly pullPieceRepository: PullPieceRepository,
    private readonly pullCheckMetrics: PullCheckCheckMetrics,
    private readonly httpClientService: HttpClientService,
  ) {}

  /**
   * Resolve and validate provider eligibility for a pull check. Throws when
   * the provider is unknown, inactive, missing a numeric provider id, or
   * missing a PDP serviceURL. Returns the enriched provider info on success.
   */
  validateProviderInfo(spAddress: string): PDPProviderEx {
    const providerInfo = this.walletSdkService.getProviderInfo(spAddress);
    if (!providerInfo) {
      throw new Error(`Storage provider not found: ${spAddress}`);
    }
    if (!providerInfo.isActive) {
      throw new Error(`Storage provider is not active: ${spAddress}`);
    }
    if (providerInfo.id == null) {
      throw new Error(`Storage provider is missing providerId: ${spAddress}`);
    }
    if (!providerInfo.pdp.serviceURL) {
      throw new Error(`Storage provider is missing serviceURL: ${spAddress}`);
    }

    return providerInfo;
  }

  /**
   * Drive one pull check through its full lifecycle:
   *   prepare pull piece -> submit pull -> poll terminal SP status
   *     -> commit on dataset -> direct `/piece/:cid` validation -> cleanup.
   *
   * NOTE: Pull-check committed pieces are not tracked in the `deal` table, so
   * `piece_cleanup` will not garbage-collect them. They will accrue on the SP
   * unless explicitly removed.
   */
  async runPullCheck(
    spAddress: string,
    signal: AbortSignal | undefined,
    logContext: ProviderJobContext,
  ): Promise<void> {
    const providerInfo = this.validateProviderInfo(spAddress);
    const labels = buildCheckMetricLabels({
      checkType: "pullCheck",
      providerId: providerInfo.id,
      providerName: providerInfo.name,
      providerIsApproved: providerInfo.isApproved,
    });

    let prepared: PullPiecePrepared | null = null;
    let requestSubmittedAt: Date | null = null;

    try {
      signal?.throwIfAborted();
      prepared = await this.preparePullPiece(spAddress);
      const pieceCidStr = prepared.registration.pieceCid;
      const pieceCidParsed = parsePieceCid(pieceCidStr);

      const synapseClient = this.requireSynapseClient();

      // Resolve pull options for either the existing-dataset or new-dataset SP
      // pull pathway. `pullPieces` requires both dataSetId and clientDataSetId
      // when targeting an existing dataset; if either is unavailable we treat
      // the request as new-dataset and rely on the signed CreateDataSetAndAddPieces.
      const payee = providerInfo.payee as Address;
      const serviceURL = providerInfo.pdp.serviceURL;
      const pullPiecesOptions = {
        serviceURL,
        pieces: [{ pieceCid: pieceCidParsed, sourceUrl: prepared.sourceUrl }],
        payee,
        signal,
      };

      requestSubmittedAt = new Date();
      await this.pullPieceRepository.markPullSubmitted(pieceCidStr, requestSubmittedAt);
      const pullResponse = await pullPieces(synapseClient, pullPiecesOptions);
      signal?.throwIfAborted();
      const requestLatencyMs = Date.now() - requestSubmittedAt.getTime();
      this.pullCheckMetrics.observeRequestLatencyMs(labels, requestLatencyMs);
      this.logger.log({
        ...logContext,
        event: "pull_request_submitted",
        message: "Pull request submitted to provider",
        pieceCid: pieceCidStr,
        pullProviderStatus: pullResponse.status,
        requestLatencyMs,
      });

      const pullPieceConfig = this.getPullPieceConfig();
      // `waitForPullStatus` polls the SP repeatedly until a terminal pull status is reported
      const finalResponse = await waitForPullStatus(synapseClient, {
        ...pullPiecesOptions,
        timeout: pullPieceConfig.pullCheckJobTimeoutSeconds * 1000,
        pollInterval: pullPieceConfig.pullCheckPollIntervalSeconds * 1000,
      });
      signal?.throwIfAborted();
      const completionLatencyMs = Date.now() - requestSubmittedAt.getTime();
      this.pullCheckMetrics.observeCompletionLatencyMs(labels, completionLatencyMs);
      // Record the SP-reported terminal pull status (one increment per check)
      this.pullCheckMetrics.recordProviderStatus(labels, finalResponse.status);

      if (finalResponse.status !== "complete") {
        throw new Error(`Storage provider failed to pull piece: status=${finalResponse.status}`);
      }

      const pieceValidated = await this.validateByDirectPieceFetch(providerInfo, pieceCidStr, logContext, signal);
      signal?.throwIfAborted();
      if (!pieceValidated) {
        throw new Error("Pull-check piece validation failed: SP did not serve the expected bytes");
      }

      const firstByteEntry = await this.pullPieceRepository.resolve(pieceCidStr);
      const firstByteMs =
        firstByteEntry?.firstByteAt && firstByteEntry?.pullSubmittedAt
          ? firstByteEntry.firstByteAt.getTime() - firstByteEntry.pullSubmittedAt.getTime()
          : null;
      if (firstByteMs != null) {
        this.pullCheckMetrics.observeFirstByteMs(labels, firstByteMs);
      }
      // Throughput approximated as pieceSize / completionLatency. This is an
      // upper-bound on actual transfer time because completionLatency includes
      // SP-side scheduling/queuing and our polling cadence.
      const throughputBps = Math.round((prepared.registration.size * 1000) / Math.max(completionLatencyMs, 1));
      this.pullCheckMetrics.observeThroughputBps(labels, throughputBps);

      this.pullCheckMetrics.recordStatus(labels, "success");
      this.logger.log({
        ...logContext,
        event: "pull_check_completed",
        message: "Pull check completed",
        pieceCid: pieceCidStr,
        requestLatencyMs,
        completionLatencyMs,
        firstByteMs,
        throughputBps,
        pieceSizeBytes: prepared.registration.size,
      });
    } catch (error) {
      this.pullCheckMetrics.recordStatus(labels, classifyFailureStatus(error));
      throw error;
    } finally {
      if (prepared) {
        const pieceCid = prepared.registration.pieceCid;
        this.pullPieceRepository.forget(pieceCid).catch((error) => {
          this.logger.warn({
            ...logContext,
            event: "pull_check_piece_forget_failed",
            message: "Failed to delete pull piece after job completion",
            pieceCid,
            error: toStructuredError(error),
          });
        });
      }
    }
  }

  /**
   * Validate that the SP serves the just-pulled piece end-to-end by fetching
   * `/piece/:pieceCid` from its PDP service URL and recomputing the piece CID
   * over the response body. Returns `false` (rather than throwing) so the
   * caller can record a domain-specific failure status; abort signals still
   * propagate as throws.
   */
  async validateByDirectPieceFetch(
    providerInfo: PDPProviderEx,
    pieceCid: string,
    logContext: ProviderJobContext,
    signal?: AbortSignal,
  ): Promise<boolean> {
    signal?.throwIfAborted();
    const pieceFetchUrl = this.constructPieceFetchUrl(providerInfo.pdp.serviceURL, pieceCid);
    try {
      const response = await this.httpClientService.requestWithMetrics<Buffer>(pieceFetchUrl, { signal });
      const calculatedPieceCid = calculate(response.data);
      return calculatedPieceCid.toString() === pieceCid;
    } catch (error) {
      // Re-throw aborts so the caller's lifecycle handles cancellation rather
      // than treating it as a validation failure.
      if (signal?.aborted) throw error;
      this.logger.warn({
        ...logContext,
        event: "pull_check_direct_piece_fetch_failed",
        message: "Direct piece fetch failed during pull-check validation",
        pieceCid,
        pieceFetchUrl,
        error: toStructuredError(error),
      });
      return false;
    }
  }

  private constructPieceFetchUrl(baseUrl: string, pieceCid: string): string {
    return `${baseUrl.replace(/\/$/, "")}/piece/${pieceCid}`;
  }

  /**
   * Generate a synthetic test piece, compute its piece CID, register it for
   * `/api/piece/:pieceCid` serving, and return the source URL plus registration.
   */
  async preparePullPiece(providerAddress: string): Promise<PullPiecePrepared> {
    const targetSize = this.getPullPieceConfig().pullCheckPieceSizeBytes;
    const key = crypto.randomBytes(16).toString("hex");

    const dataStream = this.dataSourceService.generateBytesStream({
      providerAddress,
      key,
      bytesNeeded: targetSize,
    });

    const pieceCid = await calculateFromIterable(dataStream);
    const pieceCidStr = pieceCid.toString();
    const baseUrl = this.resolvePublicBaseUrl();
    const sourceUrl = `${baseUrl}/api/piece/${pieceCidStr}`;

    const registration = {
      pieceCid: pieceCidStr,
      providerAddress,
      key,
      size: targetSize,
    };
    await this.pullPieceRepository.register(registration);

    return { registration, sourceUrl };
  }

  private getPullPieceConfig(): IPullPieceConfig {
    return this.configService.get<IPullPieceConfig>("pullPiece", { infer: true });
  }

  private resolvePublicBaseUrl(): string {
    const appConfig = this.configService.get<IAppConfig>("app");
    if (appConfig.apiPublicUrl) return appConfig.apiPublicUrl;
    return `http://${appConfig.host}:${appConfig.port}`;
  }

  private requireSynapseClient(): SynapseViemClient {
    const client = this.walletSdkService.getSynapseClient();
    if (client == null) {
      throw new Error("Synapse client unavailable: chain integration must be enabled for pull checks");
    }
    return client as SynapseViemClient;
  }

  /**
   * Stream the pull piece bytes for an active registration. Used by the
   * `/api/piece/:pieceCid` controller. Returns null when no active registration
   * exists; callers must distinguish 404 from 410 using the registry directly.
   */
  async openPullPieceStream(
    pieceCid: string,
  ): Promise<{ registration: PullPieceRegistration; stream: Readable } | null> {
    const registration = await this.pullPieceRepository.resolve(pieceCid);
    if (!registration) return null;

    const stream = this.dataSourceService.generateBytesStream({
      providerAddress: registration.providerAddress,
      key: registration.key,
      bytesNeeded: registration.size,
    });

    return { registration, stream };
  }
}
