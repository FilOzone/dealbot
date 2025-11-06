import { Index, ViewColumn, ViewEntity } from "typeorm";
import { ServiceType } from "../types.js";

@ViewEntity({
  name: "sp_performance_last_week",
  materialized: true,
  expression: `SELECT 
        sp.address as sp_address,
        
        -- Deal metrics (last 7 days)
        COUNT(DISTINCT d.id) as total_deals,
        COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'deal_created') as successful_deals,
        COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'failed') as failed_deals,
        
        -- Deal success rate (last 7 days)
        CASE 
          WHEN COUNT(DISTINCT d.id) > 0 
          THEN ROUND(
            (COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'deal_created')::numeric / 
            COUNT(DISTINCT d.id)::numeric) * 100, 
            2
          )
          ELSE 0 
        END as deal_success_rate,
        
        -- Deal latency metrics (last 7 days)
        ROUND(AVG(d.ingest_latency_ms) FILTER (WHERE d.ingest_latency_ms IS NOT NULL))::int as avg_ingest_latency_ms,
        ROUND(AVG(d.chain_latency_ms) FILTER (WHERE d.chain_latency_ms IS NOT NULL))::int as avg_chain_latency_ms,
        ROUND(AVG(d.deal_latency_ms) FILTER (WHERE d.deal_latency_ms IS NOT NULL))::int as avg_deal_latency_ms,
        
        -- Deal throughput (last 7 days)
        ROUND(AVG(d.ingest_throughput_bps) FILTER (WHERE d.ingest_throughput_bps IS NOT NULL))::bigint as avg_ingest_throughput_bps,
        
        -- Retrieval metrics (last 7 days - DIRECT_SP only)
        COUNT(DISTINCT r.id) FILTER (WHERE r.service_type = '${ServiceType.DIRECT_SP}') as total_retrievals,
        COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'success' AND r.service_type = '${ServiceType.DIRECT_SP}') as successful_retrievals,
        COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'failed' AND r.service_type = '${ServiceType.DIRECT_SP}') as failed_retrievals,
        
        -- Retrieval success rate (last 7 days)
        CASE 
          WHEN COUNT(DISTINCT r.id) FILTER (WHERE r.service_type = '${ServiceType.DIRECT_SP}') > 0 
          THEN ROUND(
            (COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'success' AND r.service_type = '${ServiceType.DIRECT_SP}')::numeric / 
            COUNT(DISTINCT r.id) FILTER (WHERE r.service_type = '${ServiceType.DIRECT_SP}')::numeric) * 100, 
            2
          )
          ELSE 0 
        END as retrieval_success_rate,
        
        -- Retrieval latency (last 7 days)
        ROUND(AVG(r.latency_ms) FILTER (WHERE r.latency_ms IS NOT NULL AND r.service_type = '${ServiceType.DIRECT_SP}'))::int as avg_retrieval_latency_ms,
        
        -- Retrieval TTFB (last 7 days)
        ROUND(AVG(r.ttfb_ms) FILTER (WHERE r.ttfb_ms IS NOT NULL AND r.service_type = '${ServiceType.DIRECT_SP}'))::int as avg_retrieval_ttfb_ms,
        
        -- Retrieval throughput (last 7 days)
        ROUND(AVG(r.throughput_bps) FILTER (WHERE r.throughput_bps IS NOT NULL AND r.service_type = '${ServiceType.DIRECT_SP}'))::bigint as avg_throughput_bps,
        
        -- IPFS retrieval metrics (last 7 days - IPFS_PIN only)
        COUNT(DISTINCT r_ipfs.id) FILTER (WHERE r_ipfs.service_type = '${ServiceType.IPFS_PIN}') as total_ipfs_retrievals,
        COUNT(DISTINCT r_ipfs.id) FILTER (WHERE r_ipfs.status = 'success' AND r_ipfs.service_type = '${ServiceType.IPFS_PIN}') as successful_ipfs_retrievals,
        COUNT(DISTINCT r_ipfs.id) FILTER (WHERE r_ipfs.status = 'failed' AND r_ipfs.service_type = '${ServiceType.IPFS_PIN}') as failed_ipfs_retrievals,
        
        -- IPFS retrieval success rate
        CASE 
          WHEN COUNT(DISTINCT r_ipfs.id) FILTER (WHERE r_ipfs.service_type = '${ServiceType.IPFS_PIN}') > 0 
          THEN ROUND(
            (COUNT(DISTINCT r_ipfs.id) FILTER (WHERE r_ipfs.status = 'success' AND r_ipfs.service_type = '${ServiceType.IPFS_PIN}')::numeric / 
            COUNT(DISTINCT r_ipfs.id) FILTER (WHERE r_ipfs.service_type = '${ServiceType.IPFS_PIN}')::numeric) * 100, 
            2
          )
          ELSE 0 
        END as ipfs_retrieval_success_rate,
        
        -- IPFS retrieval performance
        ROUND(AVG(r_ipfs.latency_ms) FILTER (WHERE r_ipfs.latency_ms IS NOT NULL AND r_ipfs.service_type = '${ServiceType.IPFS_PIN}'))::int as avg_ipfs_retrieval_latency_ms,
        ROUND(AVG(r_ipfs.ttfb_ms) FILTER (WHERE r_ipfs.ttfb_ms IS NOT NULL AND r_ipfs.service_type = '${ServiceType.IPFS_PIN}'))::int as avg_ipfs_retrieval_ttfb_ms,
        ROUND(AVG(r_ipfs.throughput_bps) FILTER (WHERE r_ipfs.throughput_bps IS NOT NULL AND r_ipfs.service_type = '${ServiceType.IPFS_PIN}'))::bigint as avg_ipfs_retrieval_throughput_bps,
        
        -- IPNI tracking metrics (last 7 days)
        COUNT(DISTINCT d.id) FILTER (WHERE d.ipni_status IS NOT NULL) as total_ipni_deals,
        COUNT(DISTINCT d.id) FILTER (WHERE d.ipni_status = 'indexed') as ipni_indexed_deals,
        COUNT(DISTINCT d.id) FILTER (WHERE d.ipni_status = 'advertised') as ipni_advertised_deals,
        COUNT(DISTINCT d.id) FILTER (WHERE d.ipni_status = 'retrieved') as ipni_retrieved_deals,
        COUNT(DISTINCT d.id) FILTER (WHERE d.ipni_status = 'failed') as ipni_failed_deals,
        
        -- IPNI success rate
        CASE 
          WHEN COUNT(DISTINCT d.id) FILTER (WHERE d.ipni_status IS NOT NULL) > 0 
          THEN ROUND(
            (COUNT(DISTINCT d.id) FILTER (WHERE d.ipni_status = 'retrieved')::numeric / 
            COUNT(DISTINCT d.id) FILTER (WHERE d.ipni_status IS NOT NULL)::numeric) * 100, 
            2
          )
          ELSE 0 
        END as ipni_success_rate,
        
        -- IPNI performance metrics
        ROUND(AVG(d.ipni_time_to_index_ms) FILTER (WHERE d.ipni_time_to_index_ms IS NOT NULL))::int as avg_ipni_time_to_index_ms,
        ROUND(AVG(d.ipni_time_to_advertise_ms) FILTER (WHERE d.ipni_time_to_advertise_ms IS NOT NULL))::int as avg_ipni_time_to_advertise_ms,
        ROUND(AVG(d.ipni_time_to_retrieve_ms) FILTER (WHERE d.ipni_time_to_retrieve_ms IS NOT NULL))::int as avg_ipni_time_to_retrieve_ms,
        ROUND(AVG(d.ipni_verified_cids_count) FILTER (WHERE d.ipni_verified_cids_count IS NOT NULL), 2) as avg_ipni_verified_cids,
        
        -- Data volumes (last 7 days)
        SUM(d.file_size) FILTER (WHERE d.status = 'deal_created') as total_data_stored_bytes,
        SUM(r.bytes_retrieved) FILTER (WHERE r.status = 'success' AND r.service_type = '${ServiceType.DIRECT_SP}') as total_data_retrieved_bytes,
        SUM(r_ipfs.bytes_retrieved) FILTER (WHERE r_ipfs.status = 'success' AND r_ipfs.service_type = '${ServiceType.IPFS_PIN}') as total_ipfs_data_retrieved_bytes,
        
        -- Last activity timestamps
        MAX(d.created_at) as last_deal_at,
        MAX(r.created_at) FILTER (WHERE r.service_type = '${ServiceType.DIRECT_SP}') as last_retrieval_at,
        MAX(r_ipfs.created_at) FILTER (WHERE r_ipfs.service_type = '${ServiceType.IPFS_PIN}') as last_ipfs_retrieval_at,
        
        NOW() as refreshed_at

      FROM storage_providers sp
      LEFT JOIN deals d ON d.sp_address = sp.address 
        AND d.created_at >= NOW() - INTERVAL '7 days'
      LEFT JOIN retrievals r ON r.deal_id = d.id 
        AND r.service_type = '${ServiceType.DIRECT_SP}'
        AND r.created_at >= NOW() - INTERVAL '7 days'
      LEFT JOIN retrievals r_ipfs ON r_ipfs.deal_id = d.id 
        AND r_ipfs.service_type = '${ServiceType.IPFS_PIN}'
        AND r_ipfs.created_at >= NOW() - INTERVAL '7 days'
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

  // IPFS retrieval metrics (7 days)
  @ViewColumn({ name: "total_ipfs_retrievals" })
  totalIpfsRetrievals: number;

  @ViewColumn({ name: "successful_ipfs_retrievals" })
  successfulIpfsRetrievals: number;

  @ViewColumn({ name: "failed_ipfs_retrievals" })
  failedIpfsRetrievals: number;

  @ViewColumn({ name: "ipfs_retrieval_success_rate" })
  ipfsRetrievalSuccessRate: number;

  @ViewColumn({ name: "avg_ipfs_retrieval_latency_ms" })
  avgIpfsRetrievalLatencyMs: number;

  @ViewColumn({ name: "avg_ipfs_retrieval_ttfb_ms" })
  avgIpfsRetrievalTtfbMs: number;

  @ViewColumn({ name: "avg_ipfs_retrieval_throughput_bps" })
  avgIpfsRetrievalThroughputBps: number;

  // IPNI tracking metrics (7 days)
  @ViewColumn({ name: "total_ipni_deals" })
  totalIpniDeals: number;

  @ViewColumn({ name: "ipni_indexed_deals" })
  ipniIndexedDeals: number;

  @ViewColumn({ name: "ipni_advertised_deals" })
  ipniAdvertisedDeals: number;

  @ViewColumn({ name: "ipni_retrieved_deals" })
  ipniRetrievedDeals: number;

  @ViewColumn({ name: "ipni_failed_deals" })
  ipniFailedDeals: number;

  @ViewColumn({ name: "ipni_success_rate" })
  ipniSuccessRate: number;

  @ViewColumn({ name: "avg_ipni_time_to_index_ms" })
  avgIpniTimeToIndexMs: number;

  @ViewColumn({ name: "avg_ipni_time_to_advertise_ms" })
  avgIpniTimeToAdvertiseMs: number;

  @ViewColumn({ name: "avg_ipni_time_to_retrieve_ms" })
  avgIpniTimeToRetrieveMs: number;

  @ViewColumn({ name: "avg_ipni_verified_cids" })
  avgIpniVerifiedCids: number;

  // Data volumes (bytes)
  @ViewColumn({ name: "total_data_stored_bytes" })
  totalDataStoredBytes: string; // bigint as string

  @ViewColumn({ name: "total_data_retrieved_bytes" })
  totalDataRetrievedBytes: string; // bigint as string

  @ViewColumn({ name: "total_ipfs_data_retrieved_bytes" })
  totalIpfsDataRetrievedBytes: string; // bigint as string

  // Activity timestamps
  @ViewColumn({ name: "last_deal_at" })
  lastDealAt: Date;

  @ViewColumn({ name: "last_retrieval_at" })
  lastRetrievalAt: Date;

  @ViewColumn({ name: "last_ipfs_retrieval_at" })
  lastIpfsRetrievalAt: Date;

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
