import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import {
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
  PrometheusModule,
} from "@willsoto/nestjs-prometheus";
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
  // Deal metrics
  makeCounterProvider({
    name: "deals_created_total",
    help: "Total number of deals created",
    labelNames: ["status", "provider"] as const,
  }),
  makeHistogramProvider({
    name: "deal_creation_duration_seconds",
    help: "Duration of deal creation in seconds",
    labelNames: ["provider"] as const,
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120],
  }),
  // Retrieval metrics
  makeCounterProvider({
    name: "retrievals_tested_total",
    help: "Total number of retrieval tests performed",
    labelNames: ["status", "method", "provider"] as const,
  }),
  makeHistogramProvider({
    name: "retrieval_latency_seconds",
    help: "Retrieval latency in seconds",
    labelNames: ["method", "provider"] as const,
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  }),
  makeHistogramProvider({
    name: "retrieval_ttfb_seconds",
    help: "Time to first byte for retrievals in seconds",
    labelNames: ["method", "provider"] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
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
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600],
  }),
  // Upload metrics
  makeHistogramProvider({
    name: "deal_upload_duration_seconds",
    help: "Duration of file upload in seconds",
    labelNames: ["provider"] as const,
    buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  }),
  // Chain metrics
  makeHistogramProvider({
    name: "deal_chain_latency_seconds",
    help: "Time from upload complete to piece added on chain in seconds",
    labelNames: ["provider"] as const,
    buckets: [1, 5, 10, 30, 60, 120, 300, 600],
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
    // HTTP metrics interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricsPrometheusInterceptor,
    },
  ],
  exports: [PrometheusModule, ...metricProviders],
})
export class MetricsPrometheusModule {}
