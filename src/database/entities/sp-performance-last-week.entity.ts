import { Index, ViewColumn, ViewEntity } from "typeorm";
import { ServiceType } from "../types.js";

@ViewEntity({
  name: "sp_performance_last_week",
  materialized: true,
  expression: `SELECT 
        sp.address as sp_address,
        
        -- Deal metrics (last 7 days)
        COUNT(DISTINCT d.id) FILTER (
          WHERE d.created_at >= NOW() - INTERVAL '7 days'
        ) as total_deals,
        
        COUNT(DISTINCT d.id) FILTER (
          WHERE d.status = 'deal_created' 
          AND d.created_at >= NOW() - INTERVAL '7 days'
        ) as successful_deals,
        
        COUNT(DISTINCT d.id) FILTER (
          WHERE d.status = 'failed' 
          AND d.created_at >= NOW() - INTERVAL '7 days'
        ) as failed_deals,
        
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
        END as deal_success_rate,
        
        -- Deal latency metrics (last 7 days, in milliseconds)
        ROUND(AVG(d.ingest_latency_ms) FILTER (
          WHERE d.ingest_latency_ms IS NOT NULL 
          AND d.created_at >= NOW() - INTERVAL '7 days'
        ))::int as avg_ingest_latency_ms,
        
        ROUND(AVG(d.chain_latency_ms) FILTER (
          WHERE d.chain_latency_ms IS NOT NULL 
          AND d.created_at >= NOW() - INTERVAL '7 days'
        ))::int as avg_chain_latency_ms,
        
        ROUND(AVG(d.deal_latency_ms) FILTER (
          WHERE d.deal_latency_ms IS NOT NULL 
          AND d.created_at >= NOW() - INTERVAL '7 days'
        ))::int as avg_deal_latency_ms,
        
        -- Deal throughput (last 7 days)
        ROUND(AVG(d.ingest_throughput_bps) FILTER (
          WHERE d.ingest_throughput_bps IS NOT NULL 
          AND d.created_at >= NOW() - INTERVAL '7 days'
        ))::bigint as avg_ingest_throughput_bps,
        
        -- Retrieval metrics (last 7 days)
        COUNT(DISTINCT r.id) FILTER (
          WHERE r.created_at >= NOW() - INTERVAL '7 days'
          AND r.service_type = '${ServiceType.DIRECT_SP}'
        ) as total_retrievals,
        
        COUNT(DISTINCT r.id) FILTER (
          WHERE r.status = 'success' 
          AND r.created_at >= NOW() - INTERVAL '7 days'
          AND r.service_type = '${ServiceType.DIRECT_SP}'
        ) as successful_retrievals,
        
        COUNT(DISTINCT r.id) FILTER (
          WHERE r.status = 'failed' 
          AND r.created_at >= NOW() - INTERVAL '7 days'
          AND r.service_type = '${ServiceType.DIRECT_SP}'
        ) as failed_retrievals,
        
        -- Retrieval success rate (last 7 days)
        CASE 
          WHEN COUNT(DISTINCT r.id) FILTER (WHERE r.created_at >= NOW() - INTERVAL '7 days') > 0 
          THEN ROUND(
            (COUNT(DISTINCT r.id) FILTER (
              WHERE r.status = 'success' 
              AND r.created_at >= NOW() - INTERVAL '7 days'
              AND r.service_type = '${ServiceType.DIRECT_SP}'
            )::numeric / 
            COUNT(DISTINCT r.id) FILTER (WHERE r.created_at >= NOW() - INTERVAL '7 days' AND r.service_type = '${ServiceType.DIRECT_SP}')::numeric) * 100, 
            2
          )
          ELSE 0 
        END as retrieval_success_rate,
        
        -- Retrieval latency (last 7 days)
        ROUND(AVG(r.latency_ms) FILTER (
          WHERE r.latency_ms IS NOT NULL 
          AND r.created_at >= NOW() - INTERVAL '7 days'
          AND r.service_type = '${ServiceType.DIRECT_SP}'
        ))::int as avg_retrieval_latency_ms,
        
        -- Retrieval TTFB (last 7 days)
        ROUND(AVG(r.ttfb_ms) FILTER (
          WHERE r.ttfb_ms IS NOT NULL 
          AND r.created_at >= NOW() - INTERVAL '7 days'
          AND r.service_type = '${ServiceType.DIRECT_SP}'
        ))::int as avg_retrieval_ttfb_ms,
        
        -- Retrieval throughput (last 7 days)
        ROUND(AVG(r.throughput_bps) FILTER (
          WHERE r.throughput_bps IS NOT NULL 
          AND r.created_at >= NOW() - INTERVAL '7 days'
          AND r.service_type = '${ServiceType.DIRECT_SP}'
        ))::bigint as avg_throughput_bps,
        
        -- Data volumes (last 7 days)
        SUM(d.file_size) FILTER (
          WHERE d.status = 'deal_created' 
          AND d.created_at >= NOW() - INTERVAL '7 days'
        ) as total_data_stored_bytes,
        
        SUM(r.bytes_retrieved) FILTER (
          WHERE r.status = 'success' 
          AND r.created_at >= NOW() - INTERVAL '7 days'
          AND r.service_type = '${ServiceType.DIRECT_SP}'
        ) as total_data_retrieved_bytes,
        
        -- Last activity timestamps
        MAX(d.created_at) FILTER (WHERE d.created_at >= NOW() - INTERVAL '7 days') as last_deal_at,
        MAX(r.created_at) FILTER (WHERE r.created_at >= NOW() - INTERVAL '7 days' AND r.service_type = '${ServiceType.DIRECT_SP}') as last_retrieval_at,
        
        NOW() as refreshed_at

      FROM storage_providers sp
      LEFT JOIN deals d ON d.sp_address = sp.address
      LEFT JOIN retrievals r ON r.deal_id = d.id
      GROUP BY sp.address;`,
})
export class SpPerformanceLastWeek {
  @Index("idx_sp_performance_last_week_sp_address", { unique: true })
  @ViewColumn({ name: "sp_address" })
  spAddress: string;

  // Deal metrics (7 days)
  @ViewColumn({ name: "total_deals" })
  totalDeals: number;

  @ViewColumn({ name: "successful_deals" })
  successfulDeals: number;

  @ViewColumn({ name: "failed_deals" })
  failedDeals: number;

  @ViewColumn({ name: "deal_success_rate" })
  dealSuccessRate: number;

  // Deal latency metrics (milliseconds)
  @ViewColumn({ name: "avg_ingest_latency_ms" })
  avgIngestLatencyMs: number;

  @ViewColumn({ name: "avg_chain_latency_ms" })
  avgChainLatencyMs: number;

  @ViewColumn({ name: "avg_deal_latency_ms" })
  avgDealLatencyMs: number;

  // Deal throughput (bytes per second)
  @ViewColumn({ name: "avg_ingest_throughput_bps" })
  avgIngestThroughputBps: number;

  // Retrieval metrics (7 days)
  @ViewColumn({ name: "total_retrievals" })
  totalRetrievals: number;

  @ViewColumn({ name: "successful_retrievals" })
  successfulRetrievals: number;

  @ViewColumn({ name: "failed_retrievals" })
  failedRetrievals: number;

  @ViewColumn({ name: "retrieval_success_rate" })
  retrievalSuccessRate: number;

  // Retrieval latency metrics (milliseconds)
  @ViewColumn({ name: "avg_retrieval_latency_ms" })
  avgRetrievalLatencyMs: number;

  @ViewColumn({ name: "avg_retrieval_ttfb_ms" })
  avgRetrievalTtfbMs: number;

  // Retrieval throughput (bytes per second)
  @ViewColumn({ name: "avg_throughput_bps" })
  avgThroughputBps: number;

  // Data volumes (bytes)
  @ViewColumn({ name: "total_data_stored_bytes" })
  totalDataStoredBytes: string; // bigint as string

  @ViewColumn({ name: "total_data_retrieved_bytes" })
  totalDataRetrievedBytes: string; // bigint as string

  // Activity timestamps
  @ViewColumn({ name: "last_deal_at" })
  lastDealAt: Date;

  @ViewColumn({ name: "last_retrieval_at" })
  lastRetrievalAt: Date;

  // Metadata
  @ViewColumn({ name: "refreshed_at" })
  refreshedAt: Date;

  /**
   * Check if provider is active (had activity in last 7 days)
   */
  hasActivity(): boolean {
    return this.totalDeals > 0 || this.totalRetrievals > 0;
  }

  /**
   * Get overall health score (0-100)
   * Based on success rates and activity
   */
  getHealthScore(): number {
    if (!this.hasActivity()) {
      return 0;
    }

    const dealScore = this.dealSuccessRate || 0;
    const retrievalScore = this.retrievalSuccessRate || 0;

    // Weighted average: 60% deal success, 40% retrieval success
    return Math.round(dealScore * 0.6 + retrievalScore * 0.4);
  }

  /**
   * Calculate average data size per deal (in bytes)
   */
  getAvgDealSize(): number | null {
    if (this.successfulDeals === 0) {
      return null;
    }

    return Math.round(Number(this.totalDataStoredBytes) / this.successfulDeals);
  }
}
