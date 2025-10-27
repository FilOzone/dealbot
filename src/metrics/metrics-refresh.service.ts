import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";

/**
 * Service responsible for refreshing materialized views and aggregating metrics
 * Uses cron jobs to periodically update pre-computed performance summaries
 *
 * Refresh Schedule:
 * - Weekly performance: Every 30 minutes (high frequency for recent data)
 * - All-time performance: Every hour (lower frequency for historical data)
 * - Daily metrics: Daily at 00:05 (aggregate previous day's data)
 * - Cleanup: Weekly on Sunday at 02:00 (archive/delete old data)
 */
@Injectable()
export class MetricsRefreshService {
  private readonly logger = new Logger(MetricsRefreshService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Refresh weekly performance materialized view
   * Runs every 30 minutes to keep recent metrics up-to-date
   *
   * Uses CONCURRENTLY to avoid blocking reads during refresh
   */
  @Cron(CronExpression.EVERY_30_MINUTES, {
    name: "refresh-weekly-performance",
  })
  async refreshWeeklyPerformance(): Promise<void> {
    const startTime = Date.now();
    this.logger.log("Starting refresh of sp_performance_weekly materialized view");

    try {
      await this.dataSource.query("SELECT refresh_sp_performance_weekly()");

      const duration = Date.now() - startTime;
      this.logger.log(`Successfully refreshed sp_performance_weekly in ${duration}ms`);
    } catch (error) {
      this.logger.error(`Failed to refresh sp_performance_weekly: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Refresh all-time performance materialized view
   * Runs every hour as historical data changes less frequently
   *
   * Uses CONCURRENTLY to avoid blocking reads during refresh
   */
  @Cron(CronExpression.EVERY_HOUR, {
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
   * Runs daily at 00:05 to aggregate the previous day's metrics
   *
   * Inserts aggregated data into metrics_daily table for time-series analysis
   */
  @Cron("5 0 * * *", {
    name: "aggregate-daily-metrics",
  })
  async aggregateDailyMetrics(): Promise<void> {
    const startTime = Date.now();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const today = new Date(yesterday);
    today.setDate(today.getDate() + 1);

    this.logger.log(`Starting daily metrics aggregation for ${yesterday.toISOString().split("T")[0]}`);

    try {
      // Aggregate deal metrics by storage provider
      const dealMetrics = await this.dataSource.query(
        `
        INSERT INTO metrics_daily (
          date,
          sp_address,
          total_deals,
          successful_deals,
          failed_deals,
          deal_success_rate,
          avg_deal_latency_ms,
          avg_ingest_latency_ms,
          avg_chain_latency_ms,
          avg_ingest_throughput_bps,
          total_data_stored_bytes,
          created_at,
          updated_at
        )
        SELECT 
          $1::date as date,
          sp_address,
          COUNT(*) as total_deals,
          COUNT(*) FILTER (WHERE status = 'deal_created') as successful_deals,
          COUNT(*) FILTER (WHERE status = 'failed') as failed_deals,
          ROUND(
            (COUNT(*) FILTER (WHERE status = 'deal_created')::numeric / 
            NULLIF(COUNT(*)::numeric, 0)) * 100, 
            2
          ) as deal_success_rate,
          ROUND(AVG(deal_latency_ms), 2) as avg_deal_latency_ms,
          ROUND(AVG(ingest_latency_ms), 2) as avg_ingest_latency_ms,
          ROUND(AVG(chain_latency_ms), 2) as avg_chain_latency_ms,
          ROUND(AVG(ingest_throughput_bps), 2) as avg_ingest_throughput_bps,
          SUM(file_size) FILTER (WHERE status = 'deal_created') as total_data_stored_bytes,
          NOW() as created_at,
          NOW() as updated_at
        FROM deals
        WHERE created_at >= $1::timestamp AND created_at < $2::timestamp
        GROUP BY sp_address
        ON CONFLICT (date, sp_address) 
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
        [yesterday, today],
      );

      // Aggregate retrieval metrics by storage provider
      await this.dataSource.query(
        `
        UPDATE metrics_daily md
        SET
          total_retrievals = r.total_retrievals,
          successful_retrievals = r.successful_retrievals,
          failed_retrievals = r.failed_retrievals,
          retrieval_success_rate = r.retrieval_success_rate,
          avg_retrieval_latency_ms = r.avg_retrieval_latency_ms,
          avg_retrieval_ttfb_ms = r.avg_retrieval_ttfb_ms,
          avg_retrieval_throughput_bps = r.avg_retrieval_throughput_bps,
          total_data_retrieved_bytes = r.total_data_retrieved_bytes,
          cdn_retrievals = r.cdn_retrievals,
          direct_retrievals = r.direct_retrievals,
          avg_cdn_latency_ms = r.avg_cdn_latency_ms,
          avg_direct_latency_ms = r.avg_direct_latency_ms,
          updated_at = NOW()
        FROM (
          SELECT 
            d.sp_address,
            COUNT(ret.id) as total_retrievals,
            COUNT(ret.id) FILTER (WHERE ret.status = 'success') as successful_retrievals,
            COUNT(ret.id) FILTER (WHERE ret.status = 'failed') as failed_retrievals,
            ROUND(
              (COUNT(ret.id) FILTER (WHERE ret.status = 'success')::numeric / 
              NULLIF(COUNT(ret.id)::numeric, 0)) * 100, 
              2
            ) as retrieval_success_rate,
            ROUND(AVG(ret.latency_ms), 2) as avg_retrieval_latency_ms,
            ROUND(AVG(ret.ttfb_ms), 2) as avg_retrieval_ttfb_ms,
            ROUND(AVG(ret.throughput_bps), 2) as avg_retrieval_throughput_bps,
            SUM(ret.bytes_retrieved) FILTER (WHERE ret.status = 'success') as total_data_retrieved_bytes,
            COUNT(ret.id) FILTER (WHERE ret.service_type = 'cdn') as cdn_retrievals,
            COUNT(ret.id) FILTER (WHERE ret.service_type = 'direct_sp') as direct_retrievals,
            ROUND(AVG(ret.latency_ms) FILTER (WHERE ret.service_type = 'cdn'), 2) as avg_cdn_latency_ms,
            ROUND(AVG(ret.latency_ms) FILTER (WHERE ret.service_type = 'direct_sp'), 2) as avg_direct_latency_ms
          FROM deals d
          INNER JOIN retrievals ret ON ret.deal_id = d.id
          WHERE ret.created_at >= $1::timestamp AND ret.created_at < $2::timestamp
          GROUP BY d.sp_address
        ) r
        WHERE md.date = $1::date AND md.sp_address = r.sp_address
        `,
        [yesterday, today],
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
        WHERE date < $1::date
        RETURNING date
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
