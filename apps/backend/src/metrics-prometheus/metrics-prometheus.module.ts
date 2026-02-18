import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import {
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
  PrometheusModule,
} from "@willsoto/nestjs-prometheus";
import {
  DataStorageCheckMetrics,
  DiscoverabilityCheckMetrics,
  RetrievalCheckMetrics,
} from "../metrics/utils/check-metrics.service.js";
import { MetricsPrometheusInterceptor } from "./metrics-prometheus.interceptor.js";

const metricProviders = [
  // HTTP metrics: API request volume and latency by method/path/status.
  makeCounterProvider({
    name: "http_requests_total",
    help: "Total number of HTTP requests",
    labelNames: ["method", "path", "status_code"] as const,
  }),
  makeHistogramProvider({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "path", "status_code"] as const,
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  }),
  // Business metrics: system-state signals to be aggregated in PromQL.
  makeHistogramProvider({
    // docs/checks/events-and-metrics.md#ingestMs
    name: "ingestMs",
    help: "Time to upload a piece to a storage provider (ms)",
    labelNames: ["checkType", "providerId", "providerStatus"] as const,
    buckets: [10, 50, 100, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000],
  }),
  makeHistogramProvider({
    // docs/checks/events-and-metrics.md#ingestThroughputBps
    name: "ingestThroughputBps",
    help: "Ingest throughput in bytes per second",
    labelNames: ["checkType", "providerId", "providerStatus"] as const,
    buckets: [1e3, 1e4, 1e5, 1e6, 5e6, 1e7, 5e7, 1e8, 5e8],
  }),
  makeHistogramProvider({
    // docs/checks/events-and-metrics.md#pieceAddedOnChainMs
    name: "pieceAddedOnChainMs",
    help: "Time from upload end to piece added on-chain (ms)",
    labelNames: ["checkType", "providerId", "providerStatus"] as const,
    buckets: [10, 50, 100, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000],
  }),
  makeHistogramProvider({
    // docs/checks/events-and-metrics.md#pieceConfirmedOnChainMs
    name: "pieceConfirmedOnChainMs",
    help: "Time from piece added to piece confirmed on-chain (ms)",
    labelNames: ["checkType", "providerId", "providerStatus"] as const,
    buckets: [10, 50, 100, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000],
  }),
  makeHistogramProvider({
    // docs/checks/events-and-metrics.md#spIndexLocallyMs
    name: "spIndexLocallyMs",
    help: "Time from upload end to SP indexing locally (ms)",
    labelNames: ["checkType", "providerId", "providerStatus"] as const,
    buckets: [10, 50, 100, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000],
  }),
  makeHistogramProvider({
    // docs/checks/events-and-metrics.md#spAnnounceAdvertisementMs
    name: "spAnnounceAdvertisementMs",
    help: "Time from upload end to SP advertisement to IPNI (ms)",
    labelNames: ["checkType", "providerId", "providerStatus"] as const,
    buckets: [10, 50, 100, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000],
  }),
  makeHistogramProvider({
    // docs/checks/events-and-metrics.md#ipniVerifyMs
    name: "ipniVerifyMs",
    help: "IPNI verification duration (ms)",
    labelNames: ["checkType", "providerId", "providerStatus"] as const,
    buckets: [10, 50, 100, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000],
  }),
  makeHistogramProvider({
    // docs/checks/events-and-metrics.md#ipfsRetrievalFirstByteMs
    name: "ipfsRetrievalFirstByteMs",
    help: "Time to first byte for IPFS retrievals (ms)",
    labelNames: ["checkType", "providerId", "providerStatus"] as const,
    buckets: [1, 5, 10, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 30000],
  }),
  makeHistogramProvider({
    // docs/checks/events-and-metrics.md#ipfsRetrievalLastByteMs
    name: "ipfsRetrievalLastByteMs",
    help: "Time to last byte for IPFS retrievals (ms)",
    labelNames: ["checkType", "providerId", "providerStatus"] as const,
    buckets: [1, 5, 10, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 30000],
  }),
  makeHistogramProvider({
    // docs/checks/events-and-metrics.md#ipfsRetrievalThroughputBps
    name: "ipfsRetrievalThroughputBps",
    help: "IPFS retrieval throughput in bytes per second",
    labelNames: ["checkType", "providerId", "providerStatus"] as const,
    buckets: [1e3, 1e4, 1e5, 1e6, 5e6, 1e7, 5e7, 1e8, 5e8],
  }),
  makeHistogramProvider({
    // docs/checks/events-and-metrics.md#dataStorageCheckMs
    name: "dataStorageCheckMs",
    help: "End-to-end data storage check duration (ms)",
    labelNames: ["checkType", "providerId", "providerStatus"] as const,
    buckets: [100, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000, 600000],
  }),
  makeHistogramProvider({
    // docs/checks/events-and-metrics.md#retrievalCheckMs
    name: "retrievalCheckMs",
    help: "End-to-end retrieval check duration (ms)",
    labelNames: ["checkType", "providerId", "providerStatus"] as const,
    buckets: [100, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000, 600000],
  }),
  // Sub-status metrics (docs/checks/data-storage.md)
  makeCounterProvider({
    // docs/checks/data-storage.md#sub-status-meanings (Upload Status)
    name: "dataStorageUploadStatus",
    help: "Data storage upload sub-status counts",
    labelNames: ["checkType", "providerId", "providerStatus", "value"] as const,
  }),
  makeCounterProvider({
    // docs/checks/data-storage.md#sub-status-meanings (Onchain Status)
    name: "dataStorageOnchainStatus",
    help: "Data storage onchain sub-status counts",
    labelNames: ["checkType", "providerId", "providerStatus", "value"] as const,
  }),
  makeCounterProvider({
    // docs/checks/data-storage.md#sub-status-meanings (Discoverability Status)
    name: "discoverabilityStatus",
    help: "Discoverability sub-status counts",
    labelNames: ["checkType", "providerId", "providerStatus", "value"] as const,
  }),
  makeCounterProvider({
    // docs/checks/data-storage.md#sub-status-meanings (Retrieval Status)
    name: "retrievalStatus",
    help: "Retrieval sub-status counts",
    labelNames: ["checkType", "providerId", "providerStatus", "value"] as const,
  }),
  makeCounterProvider({
    // docs/checks/events-and-metrics.md#ipfsRetrievalHttpResponseCode
    name: "ipfsRetrievalHttpResponseCode",
    help: "HTTP response codes for IPFS retrievals",
    labelNames: ["checkType", "providerId", "providerStatus", "value"] as const,
  }),
  // Data Retention Metrics
  makeCounterProvider({
    name: "dataSetChallengeStatus",
    help: "Provider dataset challenge status",
    labelNames: ["checkType", "providerId", "providerStatus", "value"] as const,
  }),
  // Storage provider metrics: absolute counts, independent of query filters.
  makeGaugeProvider({
    name: "storage_providers_active",
    help: "Number of active storage providers",
    labelNames: ["status"] as const,
  }),
  makeGaugeProvider({
    name: "storage_providers_tested",
    help: "Number of storage providers being tested",
  }),
  // Wallet metrics: balances in base units as returned by chain services.
  makeGaugeProvider({
    name: "wallet_balance",
    help: "Wallet balance in base units (per currency)",
    labelNames: ["currency", "wallet"] as const,
  }),
  // Job scheduler metrics (pg-boss)
  /**
   * Current queued jobs per type (pg-boss state: created).
   */
  makeGaugeProvider({
    name: "jobs_queued",
    help: "Number of queued jobs (pg-boss state: created)",
    labelNames: ["job_type"] as const,
  }),
  /**
   * Jobs scheduled for retry per type (pg-boss state: retry).
   */
  makeGaugeProvider({
    name: "jobs_retry_scheduled",
    help: "Number of jobs in retry state (pg-boss state: retry)",
    labelNames: ["job_type"] as const,
  }),
  /**
   * Oldest queued job age per type (seconds).
   */
  makeGaugeProvider({
    name: "oldest_queued_age_seconds",
    help: "Age in seconds of the oldest queued job (pg-boss state: created)",
    labelNames: ["job_type"] as const,
  }),
  /**
   * Oldest in-flight job age per type (seconds).
   */
  makeGaugeProvider({
    name: "oldest_in_flight_age_seconds",
    help: "Age in seconds of the oldest active job (pg-boss state: active)",
    labelNames: ["job_type"] as const,
  }),
  /**
   * Currently executing jobs per type (pg-boss state: active).
   */
  makeGaugeProvider({
    name: "jobs_in_flight",
    help: "Number of active jobs currently executing",
    labelNames: ["job_type"] as const,
  }),
  /**
   * Manually paused jobs per type (paused = true in job_schedule_state).
   */
  makeGaugeProvider({
    name: "jobs_paused",
    help: "Number of manually paused jobs in job_schedule_state",
    labelNames: ["job_type"] as const,
  }),
  /**
   * Enqueue attempts per type (success/error).
   */
  makeCounterProvider({
    name: "jobs_enqueue_attempts_total",
    help: "Total number of enqueue attempts",
    labelNames: ["job_type", "outcome"] as const,
  }),
  /**
   * Jobs started by handlers per type.
   */
  makeCounterProvider({
    name: "jobs_started_total",
    help: "Total number of jobs started",
    labelNames: ["job_type"] as const,
  }),
  /**
   * Handler completion results per type.
   *
   * handler_result values:
   *   "success" — job ran and the check completed (regardless of business outcome)
   *   "aborted" — job ran but was terminated by the timeout abort signal
   *   "error"   — job infrastructure failure (uncaught exception in recordJobExecution)
   */
  makeCounterProvider({
    name: "jobs_completed_total",
    help: "Total number of jobs completed",
    labelNames: ["job_type", "handler_result"] as const,
  }),
  /**
   * Handler execution duration per type (seconds).
   */
  makeHistogramProvider({
    name: "job_duration_seconds",
    help: "Job execution duration in seconds",
    labelNames: ["job_type"] as const,
    buckets: [0.1, 0.5, 1, 2, 3, 4, 5, 10, 15, 20, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360, 420, 600],
  }),
];

@Global()
@Module({
  imports: [
    PrometheusModule.register({
      defaultMetrics: {
        enabled: true,
      },
      path: "/metrics",
      defaultLabels: {
        app: "dealbot",
      },
    }),
  ],
  providers: [
    ...metricProviders,
    DataStorageCheckMetrics,
    RetrievalCheckMetrics,
    DiscoverabilityCheckMetrics,
    // HTTP metrics interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricsPrometheusInterceptor,
    },
  ],
  exports: [
    PrometheusModule,
    ...metricProviders,
    DataStorageCheckMetrics,
    RetrievalCheckMetrics,
    DiscoverabilityCheckMetrics,
  ],
})
export class MetricsPrometheusModule {}
