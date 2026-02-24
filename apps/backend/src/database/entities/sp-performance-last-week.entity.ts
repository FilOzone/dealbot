import { Index, ViewColumn, ViewEntity } from "typeorm";
import { generateSpPerformanceQuery } from "../helpers/sp-performance-query.helper.js";

@ViewEntity({
  name: "sp_performance_last_week",
  materialized: true,
  expression: generateSpPerformanceQuery("d.created_at >= NOW() - INTERVAL '7 days'"),
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
  @ViewColumn({ name: "avg_retrieval_throughput_bps" })
  avgRetrievalThroughputBps: number;

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

  @ViewColumn({ name: "ipni_verified_deals" })
  ipniVerifiedDeals: number;

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

  @ViewColumn({ name: "avg_ipni_time_to_verify_ms" })
  avgIpniTimeToVerifyMs: number;

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
