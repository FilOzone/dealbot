import { ViewEntity, ViewColumn, Index } from "typeorm";

@ViewEntity({
  name: "sp_performance_all_time",
  materialized: true,
  expression: `SELECT 
        sp.address as sp_address,
        
        -- Deal metrics (all time)
        COUNT(DISTINCT d.id) as total_deals,
        COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'deal_created') as successful_deals,
        COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'failed') as failed_deals,
        
        -- Deal success rate (all time)
        CASE 
          WHEN COUNT(DISTINCT d.id) > 0 
          THEN ROUND(
            (COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'deal_created')::numeric / 
            COUNT(DISTINCT d.id)::numeric) * 100, 
            2
          )
          ELSE 0 
        END as deal_success_rate,
        
        -- Deal latency metrics (all time)
        ROUND(AVG(d.ingest_latency_ms) FILTER (WHERE d.ingest_latency_ms IS NOT NULL))::int as avg_ingest_latency_ms,
        ROUND(AVG(d.chain_latency_ms) FILTER (WHERE d.chain_latency_ms IS NOT NULL))::int as avg_chain_latency_ms,
        ROUND(AVG(d.deal_latency_ms) FILTER (WHERE d.deal_latency_ms IS NOT NULL))::int as avg_deal_latency_ms,
        
        -- Deal throughput (all time)
        ROUND(AVG(d.ingest_throughput_bps) FILTER (WHERE d.ingest_throughput_bps IS NOT NULL))::bigint as avg_ingest_throughput_bps,
        
        -- Retrieval metrics (all time)
        COUNT(DISTINCT r.id) as total_retrievals,
        COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'success') as successful_retrievals,
        COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'failed') as failed_retrievals,
        
        -- Retrieval success rate (all time)
        CASE 
          WHEN COUNT(DISTINCT r.id) > 0 
          THEN ROUND(
            (COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'success')::numeric / 
            COUNT(DISTINCT r.id)::numeric) * 100, 
            2
          )
          ELSE 0 
        END as retrieval_success_rate,
        
        -- Retrieval latency (all time)
        ROUND(AVG(r.latency_ms) FILTER (WHERE r.latency_ms IS NOT NULL))::int as avg_retrieval_latency_ms,
        
        -- Retrieval TTFB (all time)
        ROUND(AVG(r.ttfb_ms) FILTER (WHERE r.ttfb_ms IS NOT NULL))::int as avg_retrieval_ttfb_ms,
        
        -- Retrieval throughput (all time)
        ROUND(AVG(r.throughput_bps) FILTER (WHERE r.throughput_bps IS NOT NULL))::bigint as avg_throughput_bps,
        
        -- CDN vs Direct metrics (all time)
        COUNT(DISTINCT r.id) FILTER (WHERE r.service_type = 'cdn') as cdn_retrievals,
        COUNT(DISTINCT r.id) FILTER (WHERE r.service_type = 'direct_sp') as direct_retrievals,
        
        ROUND(AVG(r.latency_ms) FILTER (
          WHERE r.service_type = 'cdn' AND r.latency_ms IS NOT NULL
        ))::int as avg_cdn_latency_ms,
        
        ROUND(AVG(r.latency_ms) FILTER (
          WHERE r.service_type = 'direct_sp' AND r.latency_ms IS NOT NULL
        ))::int as avg_direct_latency_ms,
        
        -- Data volumes (all time)
        SUM(d.file_size) FILTER (WHERE d.status = 'deal_created') as total_data_stored_bytes,
        SUM(r.bytes_retrieved) FILTER (WHERE r.status = 'success') as total_data_retrieved_bytes,
        
        -- Last activity timestamps
        MAX(d.created_at) as last_deal_at,
        MAX(r.created_at) as last_retrieval_at,
        
        NOW() as refreshed_at

      FROM storage_providers sp
      LEFT JOIN deals d ON d.sp_address = sp.address
      LEFT JOIN retrievals r ON r.deal_id = d.id
      GROUP BY sp.address;`,
})
export class SpPerformanceAllTime {
  @Index("idx_sp_performance_all_time_sp_address", { unique: true })
  @ViewColumn({ name: "sp_address" })
  spAddress: string;

  // Deal metrics (all time)
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

  // Retrieval metrics (all time)
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

  // Service type breakdown
  @ViewColumn({ name: "cdn_retrievals" })
  cdnRetrievals: number;

  @ViewColumn({ name: "direct_retrievals" })
  directRetrievals: number;

  // CDN vs Direct comparison
  @ViewColumn({ name: "avg_cdn_latency_ms" })
  avgCdnLatencyMs: number;

  @ViewColumn({ name: "avg_direct_latency_ms" })
  avgDirectLatencyMs: number;

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
   * Calculate CDN performance improvement percentage
   * Returns positive number if CDN is faster, negative if slower
   */
  getCdnImprovementPercent(): number | null {
    if (!this.avgCdnLatencyMs || !this.avgDirectLatencyMs) {
      return null;
    }

    const improvement = ((this.avgDirectLatencyMs - this.avgCdnLatencyMs) / this.avgDirectLatencyMs) * 100;
    return Math.round(improvement * 100) / 100;
  }

  /**
   * Check if provider has any activity
   */
  hasActivity(): boolean {
    return this.totalDeals > 0 || this.totalRetrievals > 0;
  }

  /**
   * Get overall reliability score (0-100)
   * Based on lifetime success rates
   */
  getReliabilityScore(): number {
    if (!this.hasActivity()) {
      return 0;
    }

    const dealScore = this.dealSuccessRate || 0;
    const retrievalScore = this.retrievalSuccessRate || 0;

    // Weighted average: 60% deal success, 40% retrieval success
    return Math.round(dealScore * 0.6 + retrievalScore * 0.4);
  }

  /**
   * Get provider experience level based on total activity
   */
  getExperienceLevel(): "new" | "intermediate" | "experienced" | "veteran" {
    const totalActivity = this.totalDeals + this.totalRetrievals;

    if (totalActivity < 10) return "new";
    if (totalActivity < 100) return "intermediate";
    if (totalActivity < 1000) return "experienced";
    return "veteran";
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
