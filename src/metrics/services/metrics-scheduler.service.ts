import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";

/**
 * Service responsible for refreshing materialized views and aggregating metrics
 * Uses cron jobs to periodically update pre-computed performance summaries
 *
 * Refresh Schedule:
 * - Weekly performance: Every 30 minutes (high frequency for recent data)
 * - All-time performance: Every 30 minutes (lower frequency for historical data)
 * - Daily metrics: Daily at 00:05 (aggregate previous day's data)
 * - Cleanup: Weekly on Sunday at 02:00 (archive/delete old data)
 */
@Injectable()
export class MetricsSchedulerService {
  private readonly logger = new Logger(MetricsSchedulerService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Refresh last week performance materialized view
   * Runs every 30 minutes to keep recent metrics up-to-date
   *
   * Uses CONCURRENTLY to avoid blocking reads during refresh
   */
  @Cron(CronExpression.EVERY_30_MINUTES, {
    name: "refresh-last-week-performance",
  })
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
   * Runs every 30 minutes as historical data changes less frequently
   *
   * Uses CONCURRENTLY to avoid blocking reads during refresh
   */
  @Cron(CronExpression.EVERY_30_MINUTES, {
    name: "refresh-all-time-performance",
  })
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
   * Runs every 30 minutes to keep today's metrics up-to-date
   *
   * Aggregates data from start of today (00:00:00) until now
   * Uses ON CONFLICT to update existing records, providing real-time metrics
   */
  @Cron(CronExpression.EVERY_30_MINUTES, {
    name: "aggregate-daily-metrics",
  })
  async aggregateDailyMetrics(): Promise<void> {
    const startTime = Date.now();

    // Real-time aggregation: from start of today until now
    const targetDate = new Date();
    targetDate.setHours(0, 0, 0, 0); // Start of today

    const now = new Date(); // Current time (end of range)

    this.logger.log(
      `Starting daily metrics aggregation for ${targetDate.toISOString().split("T")[0]} (up to ${now.toTimeString().split(" ")[0]})`,
    );

    try {
      // Aggregate deal metrics by storage provider (no service_type for deals)
      const dealMetrics = await this.dataSource.query(
        `
        INSERT INTO metrics_daily (
          daily_bucket,
          sp_address,
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
          created_at,
          updated_at
        )
        SELECT 
          $1::timestamptz as daily_bucket,
          sp_address,
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
          NOW() as created_at,
          NOW() as updated_at
        FROM deals
        WHERE created_at >= $1::timestamp AND created_at < $2::timestamp
        GROUP BY sp_address
        ON CONFLICT (daily_bucket, sp_address, service_type) 
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
          updated_at = NOW()
        RETURNING sp_address
        `,
        [targetDate, now],
      );

      // Aggregate retrieval metrics by storage provider AND service_type
      await this.dataSource.query(
        `
        INSERT INTO metrics_daily (
          daily_bucket,
          sp_address,
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
          $1::timestamptz as daily_bucket,
          d.sp_address,
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
        WHERE ret.created_at >= $1::timestamp AND ret.created_at < $2::timestamp
        GROUP BY d.sp_address, ret.service_type
        ON CONFLICT (daily_bucket, sp_address, service_type)
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
        [targetDate, now],
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
