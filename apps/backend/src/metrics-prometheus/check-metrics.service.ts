import { Injectable, Logger } from "@nestjs/common";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import type { Counter, Histogram } from "prom-client";
import type { Deal } from "../database/entities/deal.entity.js";
import type { RetrievalExecutionResult } from "../retrieval-addons/types.js";
import { buildCheckMetricLabels, type CheckMetricLabels } from "./check-metric-labels.js";

const metricsLogger = new Logger("CheckMetrics");

function observePositive<T extends CheckMetricLabels>(
  metric: Histogram,
  labels: T,
  value: number | null | undefined,
): void {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    metricsLogger.warn({
      event: "metric_value_dropped",
      message: "Dropping non-finite or non-positive metric value",
      value,
      context: "observePositive",
    });
    return;
  }
  metric.observe(labels, value);
}

function classifyHttpResponseCode(statusCode: number): string {
  if (!Number.isFinite(statusCode) || statusCode <= 0) return "failure";
  if (statusCode === 200) return "200";
  if (statusCode === 500) return "500";
  if (statusCode >= 200 && statusCode < 300) return "2xxSuccess";
  if (statusCode >= 400 && statusCode < 500) return "4xxClientError";
  if (statusCode >= 500 && statusCode < 600) return "5xxServerError";
  return "otherHttpStatusCodes";
}

@Injectable()
export class DataStorageCheckMetrics {
  constructor(
    @InjectMetric("ingestMs")
    private readonly ingestMs: Histogram,
    @InjectMetric("ingestThroughputBps")
    private readonly ingestThroughputBps: Histogram,
    @InjectMetric("pieceAddedOnChainMs")
    private readonly pieceAddedOnChainMs: Histogram,
    @InjectMetric("pieceConfirmedOnChainMs")
    private readonly pieceConfirmedOnChainMs: Histogram,
    @InjectMetric("dataStorageCheckMs")
    private readonly dataStorageCheckMs: Histogram,
    @InjectMetric("dataStorageUploadStatus")
    private readonly uploadStatusCounter: Counter,
    @InjectMetric("dataStorageOnchainStatus")
    private readonly onchainStatusCounter: Counter,
    @InjectMetric("dataStorageStatus")
    private readonly dataStorageStatusCounter: Counter,
  ) {}

  observeIngestMs(labels: CheckMetricLabels, value: number | null | undefined): void {
    observePositive(this.ingestMs, labels, value);
  }

  observeIngestThroughput(labels: CheckMetricLabels, value: number | null | undefined): void {
    observePositive(this.ingestThroughputBps, labels, value);
  }

  observePieceAddedOnChainMs(labels: CheckMetricLabels, value: number | null | undefined): void {
    observePositive(this.pieceAddedOnChainMs, labels, value);
  }

  observePieceConfirmedOnChainMs(labels: CheckMetricLabels, value: number | null | undefined): void {
    observePositive(this.pieceConfirmedOnChainMs, labels, value);
  }

  observeCheckDuration(labels: CheckMetricLabels, value: number | null | undefined): void {
    observePositive(this.dataStorageCheckMs, labels, value);
  }

  recordUploadStatus(labels: CheckMetricLabels, value: string): void {
    this.uploadStatusCounter.inc({ ...labels, value });
  }

  recordOnchainStatus(labels: CheckMetricLabels, value: string): void {
    this.onchainStatusCounter.inc({ ...labels, value });
  }

  /**
   * Record overall data storage check status.
   * Emit "pending" when the check starts; emit "success" | "failure.timedout" | "failure.other" when it completes.
   * See data-storage.md#deal-status-progression.
   */
  recordDataStorageStatus(labels: CheckMetricLabels, value: string): void {
    this.dataStorageStatusCounter.inc({ ...labels, value });
  }
}

@Injectable()
export class RetrievalCheckMetrics {
  constructor(
    @InjectMetric("ipfsRetrievalFirstByteMs")
    private readonly ipfsRetrievalFirstByteMs: Histogram,
    @InjectMetric("ipfsRetrievalBlockFirstByteMs")
    private readonly ipfsRetrievalBlockFirstByteMs: Histogram,
    @InjectMetric("ipfsRetrievalLastByteMs")
    private readonly ipfsRetrievalLastByteMs: Histogram,
    @InjectMetric("ipfsRetrievalThroughputBps")
    private readonly ipfsRetrievalThroughputBps: Histogram,
    @InjectMetric("retrievalCheckMs")
    private readonly retrievalCheckMs: Histogram,
    @InjectMetric("retrievalStatus")
    private readonly retrievalStatusCounter: Counter,
    @InjectMetric("ipfsRetrievalHttpResponseCode")
    private readonly retrievalHttpResponseCounter: Counter,
  ) {}

  observeFirstByteMs(labels: CheckMetricLabels, value: number | null | undefined): void {
    observePositive(this.ipfsRetrievalFirstByteMs, labels, value);
  }

  observeBlockFirstByteMs(labels: CheckMetricLabels, value: number | null | undefined): void {
    observePositive(this.ipfsRetrievalBlockFirstByteMs, labels, value);
  }

  observeLastByteMs(labels: CheckMetricLabels, value: number | null | undefined): void {
    observePositive(this.ipfsRetrievalLastByteMs, labels, value);
  }

  observeThroughput(labels: CheckMetricLabels, value: number | null | undefined): void {
    observePositive(this.ipfsRetrievalThroughputBps, labels, value);
  }

  observeCheckDuration(labels: CheckMetricLabels, value: number | null | undefined): void {
    observePositive(this.retrievalCheckMs, labels, value);
  }

  recordStatus(labels: CheckMetricLabels, value: string): void {
    this.retrievalStatusCounter.inc({ ...labels, value });
  }

  recordHttpResponseCode(labels: CheckMetricLabels, statusCode: number): void {
    this.retrievalHttpResponseCounter.inc({
      ...labels,
      value: classifyHttpResponseCode(statusCode),
    });
  }

  recordResultMetrics(results: RetrievalExecutionResult[], labels: CheckMetricLabels): void {
    for (const result of results) {
      if (result.success) {
        this.observeFirstByteMs(labels, result.metrics.ttfb);
        this.observeLastByteMs(labels, result.metrics.latency);
        this.observeThroughput(labels, result.metrics.throughput);
        if (result.validation?.blockTtfbMs) {
          for (const ttfb of result.validation.blockTtfbMs) {
            this.observeBlockFirstByteMs(labels, ttfb);
          }
        }
      }
      this.recordHttpResponseCode(labels, result.metrics.statusCode);
    }
  }
}

export type IpniVerifyOutcome = "verified" | "timeout" | "error";

export function classifyIpniVerifyOutcome(
  ipniResult: { rootCIDVerified: boolean; durationMs: number },
  timeoutMs: number,
): IpniVerifyOutcome {
  if (ipniResult.rootCIDVerified) return "verified";
  if (ipniResult.durationMs >= timeoutMs) return "timeout";
  return "error";
}

@Injectable()
export class DiscoverabilityCheckMetrics {
  private readonly logger = new Logger(DiscoverabilityCheckMetrics.name);

  constructor(
    @InjectMetric("spIndexLocallyMs")
    private readonly spIndexLocallyMs: Histogram,
    @InjectMetric("spAnnounceAdvertisementMs")
    private readonly spAnnounceAdvertisementMs: Histogram,
    @InjectMetric("ipniVerifyMs")
    private readonly ipniVerifyMs: Histogram,
    @InjectMetric("discoverabilityStatus")
    private readonly discoverabilityStatusCounter: Counter,
  ) {}

  observeSpIndexLocallyMs(labels: CheckMetricLabels | null, value: number | null | undefined): void {
    if (!labels) {
      this.logger.warn({
        event: "metric_emit_failed",
        message: "Cannot emit spIndexLocallyMs: no provider labels",
        metric: "spIndexLocallyMs",
      });
      return;
    }
    observePositive(this.spIndexLocallyMs, labels, value);
  }

  observeSpAnnounceAdvertisementMs(labels: CheckMetricLabels | null, value: number | null | undefined): void {
    if (!labels) {
      this.logger.warn({
        event: "metric_emit_failed",
        message: "Cannot emit spAnnounceAdvertisementMs: no provider labels",
        metric: "spAnnounceAdvertisementMs",
      });
      return;
    }
    observePositive(this.spAnnounceAdvertisementMs, labels, value);
  }

  observeIpniVerifyMs(
    labels: CheckMetricLabels | null,
    value: number | null | undefined,
    outcome: IpniVerifyOutcome,
  ): void {
    if (!labels) {
      this.logger.warn({
        event: "metric_emit_failed",
        message: "Cannot emit ipniVerifyMs: no provider labels",
        metric: "ipniVerifyMs",
      });
      return;
    }
    observePositive(this.ipniVerifyMs, { ...labels, value: outcome }, value);
  }

  recordStatus(labels: CheckMetricLabels | null, value: string): void {
    if (!labels) {
      this.logger.warn({
        event: "metric_emit_failed",
        message: "Cannot emit discoverabilityStatus: no provider labels",
        metric: "discoverabilityStatus",
        value,
      });
      return;
    }
    this.discoverabilityStatusCounter.inc({ ...labels, value });
  }

  buildLabelsForDeal(deal: Deal): CheckMetricLabels | null {
    if (!deal.spAddress) return null;
    return buildCheckMetricLabels({
      checkType: "dataStorage",
      providerId: deal.storageProvider?.providerId,
      providerName: deal.storageProvider?.name,
      providerIsApproved: deal.storageProvider?.isApproved,
    });
  }
}

@Injectable()
export class DataSetCreationCheckMetrics {
  constructor(
    @InjectMetric("dataSetCreationMs")
    private readonly dataSetCreationMs: Histogram,
    @InjectMetric("dataSetCreationStatus")
    private readonly dataSetCreationStatusCounter: Counter,
  ) {}

  observeCheckDuration(labels: CheckMetricLabels, value: number | null | undefined): void {
    observePositive(this.dataSetCreationMs, labels, value);
  }

  recordStatus(labels: CheckMetricLabels, value: string): void {
    this.dataSetCreationStatusCounter.inc({ ...labels, value });
  }
}

@Injectable()
export class PullCheckCheckMetrics {
  constructor(
    @InjectMetric("pullRequestAcknowledgementLatencyMs")
    private readonly pullRequestAcknowledgementLatencyMs: Histogram,
    @InjectMetric("pullRequestStartedMs")
    private readonly pullRequestStartedMs: Histogram,
    @InjectMetric("pullRequestCompletionLatencyMs")
    private readonly pullRequestCompletionLatencyMs: Histogram,
    @InjectMetric("pullRequestProviderStatus")
    private readonly pullRequestProviderStatusCounter: Counter,
    @InjectMetric("pullRequestThroughputBps")
    private readonly pullRequestThroughputBps: Histogram,
    @InjectMetric("pullCheckStatus")
    private readonly pullCheckStatusCounter: Counter,
  ) {}

  observeAcknowledgementLatencyMs(labels: CheckMetricLabels, value: number | null | undefined): void {
    observePositive(this.pullRequestAcknowledgementLatencyMs, labels, value);
  }

  observeStartedMs(labels: CheckMetricLabels, value: number | null | undefined): void {
    observePositive(this.pullRequestStartedMs, labels, value);
  }

  observeCompletionLatencyMs(labels: CheckMetricLabels, value: number | null | undefined): void {
    observePositive(this.pullRequestCompletionLatencyMs, labels, value);
  }

  recordProviderStatus(labels: CheckMetricLabels, value: string): void {
    this.pullRequestProviderStatusCounter.inc({ ...labels, value });
  }

  observeThroughputBps(labels: CheckMetricLabels, value: number | null | undefined): void {
    observePositive(this.pullRequestThroughputBps, labels, value);
  }

  recordStatus(labels: CheckMetricLabels, value: string): void {
    this.pullCheckStatusCounter.inc({ ...labels, value });
  }
}
