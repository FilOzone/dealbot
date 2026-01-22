import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import type { IConfig, ISchedulingConfig } from "../../config/app.config.js";
import { IpniStatus } from "../../database/types.js";
import { DbAnchoredScheduler } from "../../scheduler/db-anchored-scheduler.js";

/**
 * Service responsible for refreshing materialized views and aggregating metrics.
 *
 * Scheduling approach:
 * - Each job schedules its next run based on the latest DB timestamp (created_at/refreshed_at) + interval.
 * - If no rows exist yet, it schedules for now + start offset to stagger the first run.
 * - This avoids wall-clock alignment and reduces delay to first jobs after a restart.
 *
 * This approach ensures consistent scheduling despite re-deploys or restarts.
 */
@Injectable()
export class MetricsSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(MetricsSchedulerService.name);
  private readonly dbScheduler: DbAnchoredScheduler;

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService<IConfig, true>,
  ) {
    this.dbScheduler = new DbAnchoredScheduler(this.logger);
  }

  async onModuleInit() {
    await this.setupMetricsSchedules();
  }

  /**
   * Schedule metrics jobs using DB timestamps and startup offsets.
   */
  private async setupMetricsSchedules(): Promise<void> {
    const config = this.configService.get<ISchedulingConfig>("scheduling");
    const baseOffsetSeconds = Math.max(0, config.metricsStartOffsetSeconds);

    await this.scheduleInitialRun({
      jobName: "aggregate-daily-metrics",
      intervalSeconds: 1800,
      startOffsetSeconds: baseOffsetSeconds,
      getLastRunAt: () => this.getLastDailyCreatedTime(),
      run: () => this.aggregateDailyMetrics(),
    });

    await this.scheduleInitialRun({
      jobName: "refresh-last-week-performance",
      intervalSeconds: 1800,
      startOffsetSeconds: baseOffsetSeconds + 300,
      getLastRunAt: () => this.getLastWeekRefreshTime(),
      run: () => this.refreshWeeklyPerformance(),
    });

    await this.scheduleInitialRun({
      jobName: "refresh-all-time-performance",
      intervalSeconds: 1800,
      startOffsetSeconds: baseOffsetSeconds + 600,
      getLastRunAt: () => this.getLastAllTimeRefreshTime(),
      run: () => this.refreshAllTimePerformance(),
    });

    this.logger.log("Metrics scheduler setup: daily metrics + performance refresh every 1800s");
  }

  private async scheduleInitialRun({
    jobName,
    intervalSeconds,
    startOffsetSeconds,
    getLastRunAt,
    run,
  }: {
    jobName: string;
    intervalSeconds: number;
    startOffsetSeconds: number;
    getLastRunAt: () => Promise<Date | null>;
    run: () => Promise<void>;
  }): Promise<void> {
    await this.dbScheduler.scheduleInitialRun({
      jobName,
      intervalSeconds,
      startOffsetSeconds,
      getLastRunAt,
      run,
    });
  }

  /**
   * Returns the most recent metrics_daily insert timestamp.
   */
  private async getLastDailyCreatedTime(): Promise<Date | null> {
    const rows = await this.dataSource.query("SELECT MAX(created_at) AS last_created FROM metrics_daily");
    return this.parseTimestamp(rows?.[0]?.last_created);
  }

  /**
   * Returns the most recent refresh timestamp for last-week materialized view.
   */
  private async getLastWeekRefreshTime(): Promise<Date | null> {
    const rows = await this.dataSource.query(
      "SELECT MAX(refreshed_at) AS last_refreshed FROM sp_performance_last_week",
    );
    return this.parseTimestamp(rows?.[0]?.last_refreshed);
  }

  /**
   * Returns the most recent refresh timestamp for all-time materialized view.
   */
  private async getLastAllTimeRefreshTime(): Promise<Date | null> {
    const rows = await this.dataSource.query("SELECT MAX(refreshed_at) AS last_refreshed FROM sp_performance_all_time");
    return this.parseTimestamp(rows?.[0]?.last_refreshed);
  }

  /**
   * Normalize DB timestamps to a Date instance.
   */
  private parseTimestamp(value: unknown): Date | null {
    if (!value) {
      return null;
    }

    return value instanceof Date ? value : new Date(String(value));
  }

  /**
   * Refresh last week performance materialized view
   * Scheduled dynamically based on last refresh timestamp
   *
   * Uses CONCURRENTLY to avoid blocking reads during refresh
   */
  async refreshWeeklyPerformance(): Promise<void> {
    const startTime = Date.now();
    this.logger.log("Starting refresh of sp_performance_last_week materialized view");

    try {
      await this.dataSource.query("SELECT refresh_sp_performance_last_week()");

      const duration = Date.now() - startTime;
      this.logger.log(`Successfully refreshed sp_performance_last_week in ${duration}ms`);
    } catch (error) {
      this.logger.error(`Failed to refresh sp_performance_last_week: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Refresh all-time performance materialized view
   * Scheduled dynamically based on last refresh timestamp
   *
   * Uses CONCURRENTLY to avoid blocking reads during refresh
   */
  async refreshAllTimePerformance(): Promise<void> {
    const startTime = Date.now();
    this.logger.log("Starting refresh of sp_performance_all_time materialized view");

    try {
      await this.dataSource.query("SELECT refresh_sp_performance_all_time()");

      const duration = Date.now() - startTime;
      this.logger.log(`Successfully refreshed sp_performance_all_time in ${duration}ms`);
    } catch (error) {
      this.logger.error(`Failed to refresh sp_performance_all_time: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Aggregate daily metrics
   * Scheduled dynamically based on last insert timestamp
   *
   * Aggregates data from start of today (00:00:00) until now
   * Uses ON CONFLICT to update existing records, providing real-time metrics
   */
  async aggregateDailyMetrics(): Promise<void> {
    const startTime = Date.now();

    // Real-time aggregation: from start of today (UTC)
    const now = new Date(); // Current time (end of range)

    this.logger.log(
      `Starting daily metrics aggregation for ${now.toISOString().split("T")[0]} (up to ${
        now.toTimeString().split(" ")[0]
      })`,
    );

    try {
      // Aggregate deal metrics by storage provider (metric_type='deal', service_type=NULL)
      const dealMetrics = await this.dataSource.query(
        `
        INSERT INTO metrics_daily (
          daily_bucket,
          sp_address,
          metric_type,
          service_type,
          total_deals,
          successful_deals,
          failed_deals,
          deal_success_rate,
          avg_deal_latency_ms,
          avg_ingest_latency_ms,
          avg_chain_latency_ms,
          avg_ingest_throughput_bps,
          total_data_stored_bytes,
          total_retrievals,
          successful_retrievals,
          failed_retrievals,
          total_data_retrieved_bytes,
          total_ipni_deals,
          ipni_indexed_deals,
          ipni_advertised_deals,
          ipni_retrieved_deals,
          ipni_verified_deals,
          ipni_failed_deals,
          ipni_success_rate,
          avg_ipni_time_to_index_ms,
          avg_ipni_time_to_advertise_ms,
          avg_ipni_time_to_retrieve_ms,
          avg_ipni_time_to_verify_ms,
          created_at,
          updated_at
        )
        SELECT 
          date_trunc('day', $1::timestamptz) as daily_bucket,
          sp_address,
          'deal'::metrics_daily_metric_type_enum as metric_type,
          NULL as service_type,
          COUNT(*) as total_deals,
          COUNT(*) FILTER (WHERE status = 'deal_created') as successful_deals,
          COUNT(*) FILTER (WHERE status = 'failed') as failed_deals,
          COALESCE(
            ROUND(
              (COUNT(*) FILTER (WHERE status = 'deal_created')::numeric / 
              NULLIF(COUNT(*)::numeric, 0)) * 100, 
              2
            ),
            0
          ) as deal_success_rate,
          COALESCE(ROUND(AVG(deal_latency_ms), 2), 0) as avg_deal_latency_ms,
          COALESCE(ROUND(AVG(ingest_latency_ms), 2), 0) as avg_ingest_latency_ms,
          COALESCE(ROUND(AVG(chain_latency_ms), 2), 0) as avg_chain_latency_ms,
          COALESCE(ROUND(AVG(ingest_throughput_bps), 2), 0) as avg_ingest_throughput_bps,
          COALESCE(SUM(file_size) FILTER (WHERE status = 'deal_created'), 0) as total_data_stored_bytes,
          0 as total_retrievals,
          0 as successful_retrievals,
          0 as failed_retrievals,
          0 as total_data_retrieved_bytes,
          -- IPNI metrics (incremental states: PENDING -> INDEXED -> ADVERTISED -> RETRIEVED)
          COUNT(*) FILTER (WHERE ipni_status IS NOT NULL) as total_ipni_deals,
          COUNT(*) FILTER (WHERE ipni_status IN ('${IpniStatus.SP_INDEXED}', '${IpniStatus.SP_ADVERTISED}', '${IpniStatus.SP_RECEIVED_RETRIEVE_REQUEST}', '${IpniStatus.VERIFIED}')) as ipni_indexed_deals,
          COUNT(*) FILTER (WHERE ipni_status IN ('${IpniStatus.SP_ADVERTISED}', '${IpniStatus.SP_RECEIVED_RETRIEVE_REQUEST}', '${IpniStatus.VERIFIED}')) as ipni_advertised_deals,
          COUNT(*) FILTER (WHERE ipni_status IN ('${IpniStatus.SP_RECEIVED_RETRIEVE_REQUEST}', '${IpniStatus.VERIFIED}')) as ipni_retrieved_deals,
          COUNT(*) FILTER (WHERE ipni_status = '${IpniStatus.VERIFIED}') as ipni_verified_deals,
          COUNT(*) FILTER (WHERE ipni_status = '${IpniStatus.FAILED}') as ipni_failed_deals,
          COALESCE(
            ROUND(
              (COUNT(*) FILTER (WHERE ipni_status = '${IpniStatus.VERIFIED}')::numeric / 
              NULLIF(COUNT(*) FILTER (WHERE ipni_status IS NOT NULL)::numeric, 0)) * 100, 
              2
            ),
            0
          ) as ipni_success_rate,
          COALESCE(ROUND(AVG(ipni_time_to_index_ms) FILTER (WHERE ipni_time_to_index_ms IS NOT NULL), 0), 0) as avg_ipni_time_to_index_ms,
          COALESCE(ROUND(AVG(ipni_time_to_advertise_ms) FILTER (WHERE ipni_time_to_advertise_ms IS NOT NULL), 0), 0) as avg_ipni_time_to_advertise_ms,
          COALESCE(ROUND(AVG(ipni_time_to_retrieve_ms) FILTER (WHERE ipni_time_to_retrieve_ms IS NOT NULL), 0), 0) as avg_ipni_time_to_retrieve_ms,
          COALESCE(ROUND(AVG(ipni_time_to_verify_ms) FILTER (WHERE ipni_time_to_verify_ms IS NOT NULL), 0), 0) as avg_ipni_time_to_verify_ms,
          NOW() as created_at,
          NOW() as updated_at
        FROM deals
        WHERE DATE(created_at) = DATE($1::timestamp)
        GROUP BY sp_address
        ON CONFLICT (daily_bucket, sp_address, metric_type, service_type) 
        DO UPDATE SET
          total_deals = EXCLUDED.total_deals,
          successful_deals = EXCLUDED.successful_deals,
          failed_deals = EXCLUDED.failed_deals,
          deal_success_rate = EXCLUDED.deal_success_rate,
          avg_deal_latency_ms = EXCLUDED.avg_deal_latency_ms,
          avg_ingest_latency_ms = EXCLUDED.avg_ingest_latency_ms,
          avg_chain_latency_ms = EXCLUDED.avg_chain_latency_ms,
          avg_ingest_throughput_bps = EXCLUDED.avg_ingest_throughput_bps,
          total_data_stored_bytes = EXCLUDED.total_data_stored_bytes,
          total_ipni_deals = EXCLUDED.total_ipni_deals,
          ipni_indexed_deals = EXCLUDED.ipni_indexed_deals,
          ipni_advertised_deals = EXCLUDED.ipni_advertised_deals,
          ipni_retrieved_deals = EXCLUDED.ipni_retrieved_deals,
          ipni_verified_deals = EXCLUDED.ipni_verified_deals,
          ipni_failed_deals = EXCLUDED.ipni_failed_deals,
          ipni_success_rate = EXCLUDED.ipni_success_rate,
          avg_ipni_time_to_index_ms = EXCLUDED.avg_ipni_time_to_index_ms,
          avg_ipni_time_to_advertise_ms = EXCLUDED.avg_ipni_time_to_advertise_ms,
          avg_ipni_time_to_retrieve_ms = EXCLUDED.avg_ipni_time_to_retrieve_ms,
          avg_ipni_time_to_verify_ms = EXCLUDED.avg_ipni_time_to_verify_ms,
          updated_at = NOW()
        RETURNING sp_address
        `,
        [now],
      );

      // Aggregate retrieval metrics by storage provider AND service_type (metric_type='retrieval')
      await this.dataSource.query(
        `
        INSERT INTO metrics_daily (
          daily_bucket,
          sp_address,
          metric_type,
          service_type,
          total_deals,
          successful_deals,
          failed_deals,
          total_data_stored_bytes,
          total_retrievals,
          successful_retrievals,
          failed_retrievals,
          retrieval_success_rate,
          avg_retrieval_latency_ms,
          avg_retrieval_ttfb_ms,
          avg_retrieval_throughput_bps,
          total_data_retrieved_bytes,
          created_at,
          updated_at
        )
        SELECT 
          date_trunc('day', $1::timestamptz) as daily_bucket,
          d.sp_address,
          'retrieval'::metrics_daily_metric_type_enum as metric_type,
          ret.service_type::text::metrics_daily_service_type_enum as service_type,
          0 as total_deals,
          0 as successful_deals,
          0 as failed_deals,
          0 as total_data_stored_bytes,
          COUNT(ret.id) as total_retrievals,
          COUNT(ret.id) FILTER (WHERE ret.status = 'success') as successful_retrievals,
          COUNT(ret.id) FILTER (WHERE ret.status = 'failed') as failed_retrievals,
          COALESCE(
            ROUND(
              (COUNT(ret.id) FILTER (WHERE ret.status = 'success')::numeric / 
              NULLIF(COUNT(ret.id)::numeric, 0)) * 100, 
              2
            ),
            0
          ) as retrieval_success_rate,
          COALESCE(ROUND(AVG(ret.latency_ms), 2), 0) as avg_retrieval_latency_ms,
          COALESCE(ROUND(AVG(ret.ttfb_ms), 2), 0) as avg_retrieval_ttfb_ms,
          COALESCE(ROUND(AVG(ret.throughput_bps), 2), 0) as avg_retrieval_throughput_bps,
          COALESCE(SUM(ret.bytes_retrieved) FILTER (WHERE ret.status = 'success'), 0) as total_data_retrieved_bytes,
          NOW() as created_at,
          NOW() as updated_at
        FROM deals d
        INNER JOIN retrievals ret ON ret.deal_id = d.id
        WHERE DATE(ret.created_at) = DATE($1::timestamp)
        GROUP BY d.sp_address, ret.service_type
        ON CONFLICT (daily_bucket, sp_address, metric_type, service_type)
        DO UPDATE SET
          total_retrievals = EXCLUDED.total_retrievals,
          successful_retrievals = EXCLUDED.successful_retrievals,
          failed_retrievals = EXCLUDED.failed_retrievals,
          retrieval_success_rate = EXCLUDED.retrieval_success_rate,
          avg_retrieval_latency_ms = EXCLUDED.avg_retrieval_latency_ms,
          avg_retrieval_ttfb_ms = EXCLUDED.avg_retrieval_ttfb_ms,
          avg_retrieval_throughput_bps = EXCLUDED.avg_retrieval_throughput_bps,
          total_data_retrieved_bytes = EXCLUDED.total_data_retrieved_bytes,
          updated_at = NOW()
        RETURNING sp_address, service_type
        `,
        [now],
      );

      const duration = Date.now() - startTime;
      this.logger.log(`Successfully aggregated daily metrics for ${dealMetrics.length} providers in ${duration}ms`);
    } catch (error) {
      this.logger.error(`Failed to aggregate daily metrics: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Cleanup old metrics data
   * Runs weekly on Sunday at 02:00
   *
   * Archives or deletes metrics older than retention period (default: 90 days)
   */
  @Cron("0 2 * * 0", {
    name: "cleanup-old-metrics",
  })
  async cleanupOldMetrics(): Promise<void> {
    const startTime = Date.now();
    const retentionDays = 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    this.logger.log(`Starting cleanup of metrics older than ${cutoffDate.toISOString()}`);

    try {
      // Delete old daily metrics
      const result = await this.dataSource.query(
        `
        DELETE FROM metrics_daily
        WHERE daily_bucket < $1::date
        RETURNING daily_bucket
        `,
        [cutoffDate],
      );

      const duration = Date.now() - startTime;
      this.logger.log(`Successfully cleaned up ${result.length} old daily metrics records in ${duration}ms`);
    } catch (error) {
      this.logger.error(`Failed to cleanup old metrics: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Manual refresh of all materialized views
   * Useful for testing or emergency updates
   */
  async refreshAllViews(): Promise<void> {
    this.logger.log("Starting manual refresh of all materialized views");

    await Promise.all([this.refreshWeeklyPerformance(), this.refreshAllTimePerformance()]);

    this.logger.log("Successfully refreshed all materialized views");
  }

  /**
   * Get last refresh timestamps for monitoring
   */
  async getRefreshStatus(): Promise<{
    weeklyLastRefresh: Date | null;
    allTimeLastRefresh: Date | null;
  }> {
    const [weeklyResult] = await this.dataSource.query(`
      SELECT refreshed_at FROM sp_performance_weekly LIMIT 1
    `);

    const [allTimeResult] = await this.dataSource.query(`
      SELECT refreshed_at FROM sp_performance_all_time LIMIT 1
    `);

    return {
      weeklyLastRefresh: weeklyResult?.refreshed_at || null,
      allTimeLastRefresh: allTimeResult?.refreshed_at || null,
    };
  }
}
