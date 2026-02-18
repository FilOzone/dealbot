import { Injectable, Logger } from "@nestjs/common";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import type { Counter, Histogram } from "prom-client";
import type { Deal } from "../../database/entities/deal.entity.js";
import type { RetrievalExecutionResult } from "../../retrieval-addons/types.js";
import { buildCheckMetricLabels, type CheckMetricLabels } from "./check-metric-labels.js";

const metricsLogger = new Logger("CheckMetrics");

function observePositive(metric: Histogram, labels: CheckMetricLabels, value: number | null | undefined): void {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    metricsLogger.warn(`Dropping non-finite or non-positive metric value: ${value}`, "observePositive");
    return;
  }
  metric.observe({ ...labels }, value);
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
}

@Injectable()
export class RetrievalCheckMetrics {
  constructor(
    @InjectMetric("ipfsRetrievalFirstByteMs")
    private readonly ipfsRetrievalFirstByteMs: Histogram,
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
      }
      this.recordHttpResponseCode(labels, result.metrics.statusCode);
    }
  }
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
      this.logger.warn("[metrics] Cannot emit spIndexLocallyMs: no provider labels");
      return;
    }
    observePositive(this.spIndexLocallyMs, labels, value);
  }

  observeSpAnnounceAdvertisementMs(labels: CheckMetricLabels | null, value: number | null | undefined): void {
    if (!labels) {
      this.logger.warn("[metrics] Cannot emit spAnnounceAdvertisementMs: no provider labels");
      return;
    }
    observePositive(this.spAnnounceAdvertisementMs, labels, value);
  }

  observeIpniVerifyMs(labels: CheckMetricLabels | null, value: number | null | undefined): void {
    if (!labels) {
      this.logger.warn("[metrics] Cannot emit ipniVerifyMs: no provider labels");
      return;
    }
    observePositive(this.ipniVerifyMs, labels, value);
  }

  recordStatus(labels: CheckMetricLabels | null, value: string): void {
    if (!labels) {
      this.logger.warn(`[metrics] Cannot emit discoverabilityStatus (${value}): no provider labels`);
      return;
    }
    this.discoverabilityStatusCounter.inc({ ...labels, value });
  }

  buildLabelsForDeal(deal: Deal): CheckMetricLabels | null {
    if (!deal.spAddress) return null;
    return buildCheckMetricLabels({
      checkType: "dataStorage",
      providerId: deal.storageProvider?.providerId,
      providerIsApproved: deal.storageProvider?.isApproved,
    });
  }
}
