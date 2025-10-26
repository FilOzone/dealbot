import { ViewEntity, ViewColumn, Index } from "typeorm";

@ViewEntity({
  name: "sp_performance_weekly",
  materialized: true,
  expression: `SELECT 
        sp.address as sp_address,
        
        -- Deal metrics (last 7 days)
        COUNT(DISTINCT d.id) FILTER (
          WHERE d.created_at >= NOW() - INTERVAL '7 days'
        ) as total_deals_7d,
        
        COUNT(DISTINCT d.id) FILTER (
          WHERE d.status = 'deal_created' 
          AND d.created_at >= NOW() - INTERVAL '7 days'
        ) as successful_deals_7d,
        
        COUNT(DISTINCT d.id) FILTER (
          WHERE d.status = 'failed' 
          AND d.created_at >= NOW() - INTERVAL '7 days'
        ) as failed_deals_7d,
        
        -- Deal success rate (last 7 days)
        CASE 
          WHEN COUNT(DISTINCT d.id) FILTER (WHERE d.created_at >= NOW() - INTERVAL '7 days') > 0 
          THEN ROUND(
            (COUNT(DISTINCT d.id) FILTER (
              WHERE d.status = 'deal_created' 
              AND d.created_at >= NOW() - INTERVAL '7 days'
            )::numeric / 
            COUNT(DISTINCT d.id) FILTER (WHERE d.created_at >= NOW() - INTERVAL '7 days')::numeric) * 100, 
            2
          )
          ELSE 0 
        END as deal_success_rate_7d,
        
        -- Deal latency metrics (last 7 days, in milliseconds)
        ROUND(AVG(d.ingest_latency_ms) FILTER (
          WHERE d.ingest_latency_ms IS NOT NULL 
          AND d.created_at >= NOW() - INTERVAL '7 days'
        ))::int as avg_ingest_latency_ms_7d,
        
        ROUND(AVG(d.chain_latency_ms) FILTER (
          WHERE d.chain_latency_ms IS NOT NULL 
          AND d.created_at >= NOW() - INTERVAL '7 days'
        ))::int as avg_chain_latency_ms_7d,
        
        ROUND(AVG(d.deal_latency_ms) FILTER (
          WHERE d.deal_latency_ms IS NOT NULL 
          AND d.created_at >= NOW() - INTERVAL '7 days'
        ))::int as avg_deal_latency_ms_7d,
        
        -- Deal throughput (last 7 days)
        ROUND(AVG(d.ingest_throughput_bps) FILTER (
          WHERE d.ingest_throughput_bps IS NOT NULL 
          AND d.created_at >= NOW() - INTERVAL '7 days'
        ))::bigint as avg_ingest_throughput_bps_7d,
        
        -- Retrieval metrics (last 7 days)
        COUNT(DISTINCT r.id) FILTER (
          WHERE r.created_at >= NOW() - INTERVAL '7 days'
        ) as total_retrievals_7d,
        
        COUNT(DISTINCT r.id) FILTER (
          WHERE r.status = 'success' 
          AND r.created_at >= NOW() - INTERVAL '7 days'
        ) as successful_retrievals_7d,
        
        COUNT(DISTINCT r.id) FILTER (
          WHERE r.status = 'failed' 
          AND r.created_at >= NOW() - INTERVAL '7 days'
        ) as failed_retrievals_7d,
        
        -- Retrieval success rate (last 7 days)
        CASE 
          WHEN COUNT(DISTINCT r.id) FILTER (WHERE r.created_at >= NOW() - INTERVAL '7 days') > 0 
          THEN ROUND(
            (COUNT(DISTINCT r.id) FILTER (
              WHERE r.status = 'success' 
              AND r.created_at >= NOW() - INTERVAL '7 days'
            )::numeric / 
            COUNT(DISTINCT r.id) FILTER (WHERE r.created_at >= NOW() - INTERVAL '7 days')::numeric) * 100, 
            2
          )
          ELSE 0 
        END as retrieval_success_rate_7d,
        
        -- Retrieval latency (last 7 days)
        ROUND(AVG(r.latency_ms) FILTER (
          WHERE r.latency_ms IS NOT NULL 
          AND r.created_at >= NOW() - INTERVAL '7 days'
        ))::int as avg_retrieval_latency_ms_7d,
        
        -- Retrieval TTFB (last 7 days)
        ROUND(AVG(r.ttfb_ms) FILTER (
          WHERE r.ttfb_ms IS NOT NULL 
          AND r.created_at >= NOW() - INTERVAL '7 days'
        ))::int as avg_retrieval_ttfb_ms_7d,
        
        -- Retrieval throughput (last 7 days)
        ROUND(AVG(r.throughput_bps) FILTER (
          WHERE r.throughput_bps IS NOT NULL 
          AND r.created_at >= NOW() - INTERVAL '7 days'
        ))::bigint as avg_throughput_bps_7d,
        
        -- CDN vs Direct metrics (last 7 days)
        COUNT(DISTINCT r.id) FILTER (
          WHERE r.service_type = 'cdn' 
          AND r.created_at >= NOW() - INTERVAL '7 days'
        ) as cdn_retrievals_7d,
        
        COUNT(DISTINCT r.id) FILTER (
          WHERE r.service_type = 'direct_sp' 
          AND r.created_at >= NOW() - INTERVAL '7 days'
        ) as direct_retrievals_7d,
        
        ROUND(AVG(r.latency_ms) FILTER (
          WHERE r.service_type = 'cdn' 
          AND r.latency_ms IS NOT NULL 
          AND r.created_at >= NOW() - INTERVAL '7 days'
        ))::int as avg_cdn_latency_ms_7d,
        
        ROUND(AVG(r.latency_ms) FILTER (
          WHERE r.service_type = 'direct_sp' 
          AND r.latency_ms IS NOT NULL 
          AND r.created_at >= NOW() - INTERVAL '7 days'
        ))::int as avg_direct_latency_ms_7d,
        
        -- Data volumes (last 7 days)
        SUM(d.file_size) FILTER (
          WHERE d.status = 'deal_created' 
          AND d.created_at >= NOW() - INTERVAL '7 days'
        ) as total_data_stored_bytes_7d,
        
        SUM(r.bytes_retrieved) FILTER (
          WHERE r.status = 'success' 
          AND r.created_at >= NOW() - INTERVAL '7 days'
        ) as total_data_retrieved_bytes_7d,
        
        -- Last activity timestamps
        MAX(d.created_at) FILTER (WHERE d.created_at >= NOW() - INTERVAL '7 days') as last_deal_at_7d,
        MAX(r.created_at) FILTER (WHERE r.created_at >= NOW() - INTERVAL '7 days') as last_retrieval_at_7d,
        
        NOW() as refreshed_at

      FROM storage_providers sp
      LEFT JOIN deals d ON d.sp_address = sp.address
      LEFT JOIN retrievals r ON r.deal_id = d.id
      GROUP BY sp.address;`,
})
export class SpPerformanceWeekly {
  @Index("idx_sp_performance_weekly_sp_address", { unique: true })
  @ViewColumn({ name: "sp_address" })
  spAddress: string;

  // Deal metrics (7 days)
  @ViewColumn({ name: "total_deals_7d" })
  totalDeals7d: number;

  @ViewColumn({ name: "successful_deals_7d" })
  successfulDeals7d: number;

  @ViewColumn({ name: "failed_deals_7d" })
  failedDeals7d: number;

  @ViewColumn({ name: "deal_success_rate_7d" })
  dealSuccessRate7d: number;

  // Deal latency metrics (milliseconds)
  @ViewColumn({ name: "avg_ingest_latency_ms_7d" })
  avgIngestLatencyMs7d: number;

  @ViewColumn({ name: "avg_chain_latency_ms_7d" })
  avgChainLatencyMs7d: number;

  @ViewColumn({ name: "avg_deal_latency_ms_7d" })
  avgDealLatencyMs7d: number;

  // Deal throughput (bytes per second)
  @ViewColumn({ name: "avg_ingest_throughput_bps_7d" })
  avgIngestThroughputBps7d: number;

  // Retrieval metrics (7 days)
  @ViewColumn({ name: "total_retrievals_7d" })
  totalRetrievals7d: number;

  @ViewColumn({ name: "successful_retrievals_7d" })
  successfulRetrievals7d: number;

  @ViewColumn({ name: "failed_retrievals_7d" })
  failedRetrievals7d: number;

  @ViewColumn({ name: "retrieval_success_rate_7d" })
  retrievalSuccessRate7d: number;

  // Retrieval latency metrics (milliseconds)
  @ViewColumn({ name: "avg_retrieval_latency_ms_7d" })
  avgRetrievalLatencyMs7d: number;

  @ViewColumn({ name: "avg_retrieval_ttfb_ms_7d" })
  avgRetrievalTtfbMs7d: number;

  // Retrieval throughput (bytes per second)
  @ViewColumn({ name: "avg_throughput_bps_7d" })
  avgThroughputBps7d: number;

  // Service type breakdown
  @ViewColumn({ name: "cdn_retrievals_7d" })
  cdnRetrievals7d: number;

  @ViewColumn({ name: "direct_retrievals_7d" })
  directRetrievals7d: number;

  // CDN vs Direct comparison
  @ViewColumn({ name: "avg_cdn_latency_ms_7d" })
  avgCdnLatencyMs7d: number;

  @ViewColumn({ name: "avg_direct_latency_ms_7d" })
  avgDirectLatencyMs7d: number;

  // Data volumes (bytes)
  @ViewColumn({ name: "total_data_stored_bytes_7d" })
  totalDataStoredBytes7d: string; // bigint as string

  @ViewColumn({ name: "total_data_retrieved_bytes_7d" })
  totalDataRetrievedBytes7d: string; // bigint as string

  // Activity timestamps
  @ViewColumn({ name: "last_deal_at_7d" })
  lastDealAt7d: Date;

  @ViewColumn({ name: "last_retrieval_at_7d" })
  lastRetrievalAt7d: Date;

  // Metadata
  @ViewColumn({ name: "refreshed_at" })
  refreshedAt: Date;

  /**
   * Calculate CDN performance improvement percentage
   * Returns positive number if CDN is faster, negative if slower
   */
  getCdnImprovementPercent(): number | null {
    if (!this.avgCdnLatencyMs7d || !this.avgDirectLatencyMs7d) {
      return null;
    }

    const improvement = ((this.avgDirectLatencyMs7d - this.avgCdnLatencyMs7d) / this.avgDirectLatencyMs7d) * 100;
    return Math.round(improvement * 100) / 100;
  }

  /**
   * Check if provider is active (had activity in last 7 days)
   */
  isActive(): boolean {
    return this.totalDeals7d > 0 || this.totalRetrievals7d > 0;
  }

  /**
   * Get overall health score (0-100)
   * Based on success rates and activity
   */
  getHealthScore(): number {
    if (!this.isActive()) {
      return 0;
    }

    const dealScore = this.dealSuccessRate7d || 0;
    const retrievalScore = this.retrievalSuccessRate7d || 0;

    // Weighted average: 60% deal success, 40% retrieval success
    return Math.round(dealScore * 0.6 + retrievalScore * 0.4);
  }
}
