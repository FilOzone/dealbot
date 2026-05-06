import * as fs from "node:fs";
import * as path from "node:path";
import { calculate, parse as parsePieceCid } from "@filoz/synapse-core/piece";
import { pullPieces, waitForPullPieces } from "@filoz/synapse-core/sp";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Account, Address, Chain, Client, Transport } from "viem";
import { type ProviderJobContext, toStructuredError } from "../common/logging.js";
import type { IAppConfig, IConfig, IDatasetConfig, IJobsConfig } from "../config/app.config.js";
import { DataSourceService } from "../dataSource/dataSource.service.js";
import { HttpClientService } from "../http-client/http-client.service.js";
import { buildCheckMetricLabels, classifyFailureStatus } from "../metrics-prometheus/check-metric-labels.js";
import { PullCheckCheckMetrics } from "../metrics-prometheus/check-metrics.service.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { PDPProviderEx } from "../wallet-sdk/wallet-sdk.types.js";
import { HostedPieceRegistry } from "./hosted-piece.registry.js";
import type { HostedPiecePrepared } from "./pull-check.types.js";

type SynapseViemClient = Client<Transport, Chain, Account>;

@Injectable()
export class PullCheckService {
  private readonly logger = new Logger(PullCheckService.name);

  constructor(
    private readonly configService: ConfigService<IConfig, true>,
    private readonly walletSdkService: WalletSdkService,
    private readonly dataSourceService: DataSourceService,
    private readonly hostedPieceRegistry: HostedPieceRegistry,
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
   *   prepare hosted piece -> submit pull -> poll terminal SP status
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

    let prepared: HostedPiecePrepared | null = null;
    let requestSubmittedAt: Date | null = null;

    try {
      signal?.throwIfAborted();
      prepared = await this.prepareHostedPiece();
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
      this.hostedPieceRegistry.markPullSubmitted(pieceCidStr, requestSubmittedAt);
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

      const jobsConfig = this.getJobsConfig();
      // `waitForPullPieces` polls the SP repeatedly until a terminal pull status is reported
      const finalResponse = await waitForPullPieces(synapseClient, {
        ...pullPiecesOptions,
        timeout: jobsConfig.pullCheckJobTimeoutSeconds * 1000,
        pollInterval: jobsConfig.pullCheckPollIntervalSeconds * 1000,
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

      const firstByteEntry = this.hostedPieceRegistry.resolveAny(pieceCidStr);
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
      const throughputBps = Math.round((prepared.registration.byteLength * 1000) / Math.max(completionLatencyMs, 1));
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
        pieceSizeBytes: prepared.registration.byteLength,
      });
    } catch (error) {
      this.pullCheckMetrics.recordStatus(labels, classifyFailureStatus(error));
      throw error;
    } finally {
      if (prepared) {
        await this.cleanupHostedPiece(prepared.registration.pieceCid);
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
  async prepareHostedPiece(): Promise<HostedPiecePrepared> {
    const jobsConfig = this.getJobsConfig();
    const datasetConfig = this.configService.get<IDatasetConfig>("dataset");
    const targetSize = jobsConfig.pullCheckPieceSizeBytes;

    const dataFile = await this.dataSourceService.generateRandomDataset(targetSize, targetSize);
    const filePath = path.join(datasetConfig.localDatasetsPath, dataFile.name);
    const dataBytes =
      dataFile.data instanceof Uint8Array ? dataFile.data : new Uint8Array(dataFile.data as ArrayBufferLike);
    const pieceCid = calculate(dataBytes);
    const pieceCidStr = pieceCid.toString();
    const baseUrl = this.resolvePublicBaseUrl();
    const sourceUrl = `${baseUrl}/api/piece/${pieceCidStr}`;
    const expiresAt = new Date(Date.now() + jobsConfig.pullCheckHostedPieceTtlSeconds * 1000);

    const registration = {
      pieceCid: pieceCidStr,
      filePath,
      fileName: dataFile.name,
      byteLength: dataFile.size,
      contentType: "application/octet-stream",
      expiresAt,
      cleanedUp: false,
    };
    this.hostedPieceRegistry.register(registration);

    return { registration, sourceUrl };
  }

  /**
   * Mark the hosted piece as cleaned up and remove the on-disk artifact. Safe
   * to call multiple times.
   */
  async cleanupHostedPiece(pieceCid: string): Promise<void> {
    const entry = this.hostedPieceRegistry.resolveAny(pieceCid);
    if (entry && !entry.cleanedUp) {
      this.hostedPieceRegistry.markCleanedUp(pieceCid);
      try {
        await this.dataSourceService.cleanupRandomDataset(entry.fileName);
      } catch (error) {
        this.logger.warn({
          event: "pull_check_cleanup_warn",
          message: "Failed to cleanup hosted piece artifact",
          pieceCid,
          error: toStructuredError(error),
        });
      }
    }
    this.hostedPieceRegistry.forget(pieceCid);
  }

  private getJobsConfig(): IJobsConfig {
    return this.configService.get<IJobsConfig>("jobs", { infer: true });
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
   * Stream the hosted piece bytes for an active registration. Used by the
   * `/api/piece/:pieceCid` controller. Returns null when no active registration
   * exists; callers must distinguish 404 from 410 using the registry directly.
   */
  openHostedPieceStream(
    pieceCid: string,
    now: Date = new Date(),
  ): { registration: NonNullable<ReturnType<HostedPieceRegistry["resolveActive"]>>; stream: fs.ReadStream } | null {
    const registration = this.hostedPieceRegistry.resolveActive(pieceCid, now);
    if (!registration) return null;
    const stream = fs.createReadStream(registration.filePath);
    return { registration, stream };
  }
}
