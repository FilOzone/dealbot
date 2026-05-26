import * as crypto from "node:crypto";
import { calculateFromIterable, parse as parsePieceCid } from "@filoz/synapse-core/piece";
import { pullPieces, waitForPullPieces } from "@filoz/synapse-core/sp";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Address } from "viem";
import { type ProviderJobContext, toStructuredError } from "../common/logging.js";
import type { Network } from "../common/types.js";
import type { IAppConfig, IConfig, INetworkConfig } from "../config/index.js";
import { DataSourceService } from "../dataSource/dataSource.service.js";
import { HttpClientService } from "../http-client/http-client.service.js";
import { buildCheckMetricLabels, classifyFailureStatus } from "../metrics-prometheus/check-metric-labels.js";
import { PullCheckCheckMetrics } from "../metrics-prometheus/check-metrics.service.js";
import { type SynapseViemClient, WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { PDPProviderEx } from "../wallet-sdk/wallet-sdk.types.js";
import type { PullPiecePrepared, PullPieceStreamResult } from "./pull-check.types.js";
import { PullPieceRepository } from "./pull-piece.repository.js";

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
  validateProviderInfo(spAddress: string, network: Network): PDPProviderEx {
    const providerInfo = this.walletSdkService.getProviderInfo(spAddress, network);
    if (!providerInfo) {
      throw new Error(`Storage provider not found: ${spAddress} on ${network}`);
    }
    if (!providerInfo.isActive) {
      throw new Error(`Storage provider is not active: ${spAddress} on ${network}`);
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
    network: Network,
    signal: AbortSignal | undefined,
    logContext: ProviderJobContext,
  ): Promise<void> {
    const providerInfo = this.validateProviderInfo(spAddress, network);
    const labels = buildCheckMetricLabels({
      network: network,
      checkType: "pullCheck",
      providerId: providerInfo.id,
      providerName: providerInfo.name,
      providerIsApproved: providerInfo.isApproved,
    });

    let prepared: PullPiecePrepared | null = null;
    let requestSubmittedAt: Date | null = null;

    try {
      signal?.throwIfAborted();
      prepared = await this.preparePullPiece(spAddress, network);
      const pieceCidStr = prepared.registration.pieceCid;
      const pieceCidParsed = parsePieceCid(pieceCidStr);

      const synapseClient = this.requireSynapseClient(network);

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
      this.pullCheckMetrics.observeAcknowledgementLatencyMs(labels, requestLatencyMs);
      this.logger.log({
        ...logContext,
        event: "pull_request_acknowledged",
        message: "Pull request acknowledged by provider",
        pieceCid: pieceCidStr,
        pullProviderStatus: pullResponse.status,
        requestLatencyMs,
      });

      const networkCfg = this.getNetworkConfig(network);
      // `waitForPullPieces` polls the SP repeatedly until a terminal pull status is reported
      const finalResponse = await waitForPullPieces(synapseClient, {
        ...pullPiecesOptions,
        timeout: networkCfg.pullCheckJobTimeoutSeconds * 1000,
        pollInterval: networkCfg.pullCheckPollIntervalSeconds * 1000,
      });
      signal?.throwIfAborted();
      const completionLatencyMs = Date.now() - requestSubmittedAt.getTime();
      this.pullCheckMetrics.observeCompletionLatencyMs(labels, completionLatencyMs);
      // Record the SP-reported terminal pull status (one increment per check)
      this.pullCheckMetrics.recordProviderStatus(labels, finalResponse.status);

      if (finalResponse.status !== "complete") {
        throw new Error(`Storage provider failed to pull piece: status=${finalResponse.status}`);
      }

      const pieceValidated = await this.validateByDirectPieceFetch(
        providerInfo,
        pieceCidStr,
        prepared.registration.size,
        logContext,
        signal,
      );
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
        this.pullCheckMetrics.observeStartedMs(labels, firstByteMs);
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
    }
    // Pieces are not eagerly deleted here; they remain active (200) until their
    // TTL expires so that SPs polling after job end are not spuriously told 404.
    // The pull_piece_cleanup job hard-deletes once expires_at has passed.
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
    expectedSize: number,
    logContext: ProviderJobContext,
    signal?: AbortSignal,
  ): Promise<boolean> {
    signal?.throwIfAborted();
    const pieceFetchUrl = this.constructPieceFetchUrl(providerInfo.pdp.serviceURL, pieceCid);
    try {
      const response = await this.httpClientService.requestStream(pieceFetchUrl, { signal });

      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.body.destroy();
        this.logger.warn({
          ...logContext,
          event: "pull_check_direct_piece_fetch_failed",
          message: "Direct piece fetch returned non-2xx status",
          pieceCid,
          pieceFetchUrl,
          statusCode: response.statusCode,
        });
        return false;
      }

      const rawContentLength = response.headers["content-length"];
      const contentLengthHeader = Array.isArray(rawContentLength) ? rawContentLength[0] : rawContentLength;
      if (contentLengthHeader !== undefined) {
        const reportedSize = parseInt(contentLengthHeader, 10);
        if (!Number.isNaN(reportedSize) && reportedSize !== expectedSize) {
          response.body.destroy();
          this.logger.warn({
            ...logContext,
            event: "pull_check_direct_piece_size_mismatch",
            message: "Content-Length header does not match expected piece size",
            pieceCid,
            expectedSize,
            reportedSize,
          });
          return false;
        }
      }

      try {
        const calculatedPieceCid = await calculateFromIterable(response.body);
        return calculatedPieceCid.toString() === pieceCid;
      } finally {
        // Guarantee the underlying socket is released if `calculateFromIterable`
        // throws partway (e.g. invalid framing) without fully draining the body.
        if (!response.body.destroyed) response.body.destroy();
      }
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
  async preparePullPiece(providerAddress: string, network: Network): Promise<PullPiecePrepared> {
    const networkCfg = this.getNetworkConfig(network);
    const targetSize = networkCfg.pullCheckPieceSizeBytes;
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
      expiresAt: new Date(Date.now() + networkCfg.pullCheckJobTimeoutSeconds * 2 * 1000),
    };
    await this.pullPieceRepository.register(registration);

    return { registration, sourceUrl };
  }

  private getNetworkConfig(network: Network): INetworkConfig {
    return this.configService.get("networks", { infer: true })[network];
  }

  private resolvePublicBaseUrl(): string {
    const appConfig = this.configService.get<IAppConfig>("app");
    if (appConfig.apiPublicUrl) return appConfig.apiPublicUrl;
    return `http://${appConfig.host}:${appConfig.port}`;
  }

  private requireSynapseClient(network: Network): SynapseViemClient {
    const client = this.walletSdkService.getSynapseClient(network);
    if (client == null) {
      throw new Error("Synapse client unavailable: chain integration must be enabled for pull checks");
    }
    return client as SynapseViemClient;
  }

  /**
   * Delete all `pull_pieces` rows whose `expires_at` has passed.
   * Called by the scheduled `pull_piece_cleanup` global job.
   */
  async deleteExpiredPullPieces(): Promise<number> {
    return this.pullPieceRepository.deleteExpired();
  }

  /**
   * Resolve a pull piece and open a byte stream for it.
   *
   * Returns:
   * - null          → no row found; caller should respond 404
   * - { status: "gone" }    → row exists but TTL has passed; caller should respond 410
   * - { status: "active", … } → row is within TTL; caller may stream the bytes
   */
  async openPullPieceStream(pieceCid: string): Promise<PullPieceStreamResult | null> {
    const registration = await this.pullPieceRepository.resolve(pieceCid);
    if (!registration) return null;
    if (registration.expiresAt <= new Date()) return { status: "gone" };

    const stream = this.dataSourceService.generateBytesStream({
      providerAddress: registration.providerAddress,
      key: registration.key,
      bytesNeeded: registration.size,
    });

    return { status: "active", registration, stream };
  }
}
