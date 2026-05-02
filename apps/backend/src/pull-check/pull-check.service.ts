import * as fs from "node:fs";
import * as path from "node:path";
import { calculate, parse as parsePieceCid } from "@filoz/synapse-core/piece";
import { pullPieces, waitForPullPieces } from "@filoz/synapse-core/sp";
import { getDataSet } from "@filoz/synapse-core/warm-storage";
import { METADATA_KEYS, Synapse } from "@filoz/synapse-sdk";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Account, Address, Chain, Client, Transport } from "viem";
import { type ProviderJobContext, toStructuredError } from "../common/logging.js";
import { createSynapseFromConfig } from "../common/synapse-factory.js";
import type { IAppConfig, IBlockchainConfig, IConfig, IDatasetConfig, IJobsConfig } from "../config/app.config.js";
import { DataSourceService } from "../dataSource/dataSource.service.js";
import { DealService } from "../deal/deal.service.js";
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
  ) {
    this.blockchainConfig = this.configService.get("blockchain", { infer: true });
  }

  async onModuleInit() {
    this.logger.log({
      event: "synapse_initialization",
      message: "Creating shared Synapse instance",
    });
    this.sharedSynapse = await this.createSynapseInstance();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.sharedSynapse) {
      this.sharedSynapse = undefined;
    }
  }

  /**
   * Create a pending pull-check record after validating provider eligibility.
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
   * prepare hosted piece -> submit pull -> poll terminal status -> verify.
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

      const synapseClient = this.requireSynapseClient();
      const synapse = this.sharedSynapse ?? (await this.createSynapseInstance());
      const storage = await synapse.storage.createContext({
        providerId: providerInfo.id,
        metadata: this.dealService.getBaseDataSetMetadata(),
      });
      const dataSetId = storage.dataSetId;
      const clientDataSetId = dataSetId ? (await getDataSet(synapseClient, { dataSetId }))?.clientDataSetId : undefined;
      const pieceCidStr = prepared.registration.pieceCid;
      const pieceCidParsed = parsePieceCid(pieceCidStr);
      const payee = providerInfo.payee as Address;
      const serviceURL = providerInfo.pdp.serviceURL;

      const pullPiecesOptions = {
        serviceURL,
        pieces: [
          {
            pieceCid: pieceCidParsed,
            sourceUrl: prepared.sourceUrl,
          },
        ],
        ...(dataSetId && clientDataSetId ? { dataSetId, clientDataSetId } : { payee }),
        signal,
      };
      requestSubmittedAt = new Date();
      const pullResponse = await pullPieces(synapseClient, pullPiecesOptions);
      const requestCompletedAt = new Date();

      this.pullCheckMetrics.observeRequestLatencyMs(
        labels,
        requestCompletedAt.getTime() - requestSubmittedAt.getTime(),
      );
      this.pullCheckMetrics.recordProviderStatus(labels, pullResponse.status);
      this.logger.log({
        ...logContext,
        event: "pull_check_request_submitted",
        message: "Pull request submitted to provider",
        pieceCid: pieceCidStr,
        providerStatus: pullResponse.status,
      });

      const jobsConfig = this.getJobsConfig();
      const waitForPullPiecesOptions = {
        ...pullPiecesOptions,
        timeout: jobsConfig.pullCheckJobTimeoutSeconds * 1000,
        pollInterval: jobsConfig.pullCheckPollIntervalSeconds * 1000,
        onStatus: (response) => {
          this.pullCheckMetrics.recordProviderStatus(labels, response.status);
          this.logger.debug({
            ...logContext,
            event: "pull_check_status_observed",
            message: "Observed pull status",
            providerStatus: response.status,
          });
        },
      };
      const finalResponse = await waitForPullPieces(synapseClient, waitForPullPiecesOptions);

      const pieceResults = finalResponse.pieces.map((piece: { pieceCid: string; status: string }) => {
        const pieceCid = pullPiecesOptions.pieces.find((p) => p.toString() === piece.pieceCid);
        return {
          pieceCid: pieceCid?.pieceCid || piece.pieceCid,
          status: piece.status === "complete" ? ("complete" as const) : ("failed" as const),
        };
      });

      const allComplete = pieceResults.every((p: { status: string }) => p.status === "complete");

      const completedAt = new Date();

      if (allComplete) {
        this.pullCheckMetrics.recordStatus(labels, "success");
      } else {
        this.pullCheckMetrics.recordStatus(labels, "failure.other");
      }

      this.pullCheckMetrics.observeCompletionLatencyMs(labels, completedAt.getTime() - requestSubmittedAt.getTime());

      const commitResult = await storage.commit({
        pieces: pullPiecesOptions.pieces.map((pullPiece) => ({
          pieceCid: pullPiece.pieceCid,
          pieceMetadata: {
            [METADATA_KEYS.IPFS_ROOT_CID]: pullPiece.pieceCid.toString(),
          },
        })),
      });

      this.logger.log({
        event: "pull_check_commit_result",
        message: "Pull check commit result",
        commitResult,
      });
    } catch (error) {
      const failureClass = classifyFailureStatus(error);
      const completedAt = new Date();
      this.pullCheckMetrics.recordStatus(labels, failureClass);
      if (requestSubmittedAt) {
        this.pullCheckMetrics.observeCompletionLatencyMs(labels, completedAt.getTime() - requestSubmittedAt.getTime());
      }
      this.logger.error({
        ...logContext,
        event: "pull_check_failed",
        message: "Pull check failed",
        error: toStructuredError(error),
      });
    } finally {
      if (prepared) {
        await this.cleanupHostedPiece(prepared.registration.pieceCid);
      }
    }
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
        this.logger.log({
          event: "synapse_session_key_init",
          message: "Initializing Synapse with session key",
          walletAddress: this.blockchainConfig.walletAddress,
        });
      }
      return synapse;
    } catch (error) {
      this.logger.error({
        event: "synapse_init_failed",
        message: "Failed to initialize Synapse for deal job",
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
