import * as fs from "node:fs";
import * as path from "node:path";
import { calculate, parse as parsePieceCid } from "@filoz/synapse-core/piece";
import { pullPieces, waitForPullPieces } from "@filoz/synapse-core/sp";
import { getDataSet } from "@filoz/synapse-core/warm-storage";
import { Synapse } from "@filoz/synapse-sdk";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Account, Address, Chain, Client, Transport } from "viem";
import { type ProviderJobContext, toStructuredError } from "../common/logging.js";
import { createSynapseFromConfig } from "../common/synapse-factory.js";
import type { IAppConfig, IBlockchainConfig, IConfig, IDatasetConfig, IJobsConfig } from "../config/app.config.js";
import { DataSourceService } from "../dataSource/dataSource.service.js";
import { DealService } from "../deal/deal.service.js";
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
  private readonly blockchainConfig: IBlockchainConfig;
  private sharedSynapse?: Synapse;

  constructor(
    private readonly configService: ConfigService<IConfig, true>,
    private readonly walletSdkService: WalletSdkService,
    private readonly dataSourceService: DataSourceService,
    private readonly hostedPieceRegistry: HostedPieceRegistry,
    private readonly pullCheckMetrics: PullCheckCheckMetrics,
    private readonly dealService: DealService,
    private readonly httpClientService: HttpClientService,
  ) {
    this.blockchainConfig = this.configService.get("blockchain", { infer: true });
  }

  async onModuleInit() {
    this.sharedSynapse = await this.createSynapseInstance();
    this.logger.debug({
      event: "pull_check_synapse_ready",
      message: "Pull-check Synapse instance initialized",
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.sharedSynapse) {
      this.sharedSynapse = undefined;
    }
  }

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
   * Failure metric + cleanup are owned here; failure logging is owned by the
   * caller (jobs handler) so we do not double-log. Errors are re-thrown so the
   * scheduler can distinguish `aborted` vs `failed` job outcomes.
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
    this.pullCheckMetrics.recordStatus(labels, "pending");

    let prepared: HostedPiecePrepared | null = null;
    let requestSubmittedAt: Date | null = null;

    try {
      signal?.throwIfAborted();
      prepared = await this.prepareHostedPiece();
      const pieceCidStr = prepared.registration.pieceCid;
      const pieceCidParsed = parsePieceCid(pieceCidStr);

      const synapseClient = this.requireSynapseClient();
      const synapse = this.sharedSynapse ?? (await this.createSynapseInstance());
      const storage = await synapse.storage.createContext({
        providerId: providerInfo.id,
        metadata: this.dealService.getBaseDataSetMetadata(),
      });

      // Resolve pull options for either the existing-dataset or new-dataset SP
      // pull pathway. `pullPieces` requires both dataSetId and clientDataSetId
      // when targeting an existing dataset; if either is unavailable we treat
      // the request as new-dataset and rely on the signed CreateDataSetAndAddPieces.
      const dataSetId = storage.dataSetId;
      const clientDataSetId = dataSetId ? (await getDataSet(synapseClient, { dataSetId }))?.clientDataSetId : undefined;
      const payee = providerInfo.payee as Address;
      const serviceURL = providerInfo.pdp.serviceURL;
      const pullPiecesOptions = {
        serviceURL,
        pieces: [{ pieceCid: pieceCidParsed, sourceUrl: prepared.sourceUrl }],
        ...(dataSetId && clientDataSetId ? { dataSetId, clientDataSetId } : { payee }),
        signal,
      };

      requestSubmittedAt = new Date();
      const pullResponse = await pullPieces(synapseClient, pullPiecesOptions);
      signal?.throwIfAborted();
      this.pullCheckMetrics.observeRequestLatencyMs(labels, Date.now() - requestSubmittedAt.getTime());
      this.logger.debug({
        ...logContext,
        event: "pull_check_request_submitted",
        message: "Pull request submitted to provider",
        pieceCid: pieceCidStr,
        providerStatus: pullResponse.status,
      });

      const jobsConfig = this.getJobsConfig();
      // `waitForPullPieces` polls the SP repeatedly until a terminal status is
      // reported. Intentionally no `onStatus` hook: `pullCheckProviderStatus`
      // is a counter and we only want to increment it once per check, at the
      // terminal SP status (below). Per-poll increments would inflate the
      // counter by the number of polls and break its rate-based semantics.
      const finalResponse = await waitForPullPieces(synapseClient, {
        ...pullPiecesOptions,
        timeout: jobsConfig.pullCheckJobTimeoutSeconds * 1000,
        pollInterval: jobsConfig.pullCheckPollIntervalSeconds * 1000,
      });
      signal?.throwIfAborted();
      this.pullCheckMetrics.observeCompletionLatencyMs(labels, Date.now() - requestSubmittedAt.getTime());
      // Record the SP-reported terminal pull status (one increment per check)
      // regardless of outcome so both `complete` and `failed` are observable.
      this.pullCheckMetrics.recordProviderStatus(labels, finalResponse.status);

      if (finalResponse.status !== "complete") {
        throw new Error(`Storage provider failed to pull piece: status=${finalResponse.status}`);
      }

      // `pullPieces` already signed AddPieces / CreateDataSetAndAddPieces, but
      // SDK convention is to also call `storage.commit` so the on-chain add is
      // confirmed and the dataset state is observable to the client. We omit
      // pieceMetadata: `IPFS_ROOT_CID` is meaningless for synthetic pull-check
      // pieces and would corrupt downstream IPNI advertising.
      const commitResult = await storage.commit({
        pieces: pullPiecesOptions.pieces.map((p) => ({ pieceCid: p.pieceCid })),
      });
      signal?.throwIfAborted();
      this.logger.debug({
        ...logContext,
        event: "pull_check_committed",
        message: "Pull-check piece committed to dataset",
        pieceCid: pieceCidStr,
        dataSetId: commitResult.dataSetId.toString(),
        pieceIds: commitResult.pieceIds.map((id) => id.toString()),
        txHash: commitResult.txHash,
      });

      const pieceValidated = await this.validateByDirectPieceFetch(providerInfo, pieceCidStr, logContext, signal);
      signal?.throwIfAborted();
      if (!pieceValidated) {
        throw new Error("Pull-check piece validation failed: SP did not serve the expected bytes");
      }

      this.pullCheckMetrics.recordStatus(labels, "success");
    } catch (error) {
      this.pullCheckMetrics.recordStatus(labels, classifyFailureStatus(error));
      if (requestSubmittedAt) {
        this.pullCheckMetrics.observeCompletionLatencyMs(labels, Date.now() - requestSubmittedAt.getTime());
      }
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

  private async createSynapseInstance(): Promise<Synapse> {
    try {
      const { synapse, isSessionKeyMode } = await createSynapseFromConfig(this.blockchainConfig);
      if (isSessionKeyMode) {
        this.logger.debug({
          event: "pull_check_synapse_session_key_init",
          message: "Pull-check Synapse initialized with session key",
          walletAddress: this.blockchainConfig.walletAddress,
        });
      }
      return synapse;
    } catch (error) {
      this.logger.error({
        event: "pull_check_synapse_init_failed",
        message: "Failed to initialize Synapse for pull-check service",
        error: toStructuredError(error),
      });
      throw error;
    }
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
