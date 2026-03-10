import { IpniStatus, ServiceType } from "../types.js";

/**
 * Generate SQL query for SP performance materialized view
 * @param dateFilter - Optional date filter for deals (e.g., "d.created_at >= NOW() - INTERVAL '7 days'")
 * @returns SQL query string
 */
export function generateSpPerformanceQuery(dateFilter?: string): string {
  const retrievalDateFilter = dateFilter?.replaceAll("d.created_at", "r.created_at");

  return `
    WITH deals_filtered AS (
      SELECT
        d.id,
        d.sp_address,
        d.status,
        d.ingest_latency_ms,
        d.chain_latency_ms,
        d.deal_latency_ms,
        d.ingest_throughput_bps,
        d.ipni_status,
        d.ipni_time_to_index_ms,
        d.ipni_time_to_advertise_ms,
        d.ipni_time_to_verify_ms,
        d.file_size,
        d.created_at
      FROM deals d
      ${dateFilter ? `WHERE ${dateFilter}` : ""}
    ),
    deal_metrics AS (
      SELECT
        d.sp_address,
        COUNT(*) AS total_deals,
        COUNT(*) FILTER (WHERE d.status = 'deal_created') AS successful_deals,
        COUNT(*) FILTER (WHERE d.status = 'failed') AS failed_deals,
        ROUND(AVG(d.ingest_latency_ms) FILTER (WHERE d.ingest_latency_ms IS NOT NULL))::int AS avg_ingest_latency_ms,
        ROUND(AVG(d.chain_latency_ms) FILTER (WHERE d.chain_latency_ms IS NOT NULL))::int AS avg_chain_latency_ms,
        ROUND(AVG(d.deal_latency_ms) FILTER (WHERE d.deal_latency_ms IS NOT NULL))::int AS avg_deal_latency_ms,
        ROUND(AVG(d.ingest_throughput_bps) FILTER (WHERE d.ingest_throughput_bps IS NOT NULL))::bigint AS avg_ingest_throughput_bps,
        COUNT(*) FILTER (WHERE d.ipni_status IS NOT NULL) AS total_ipni_deals,
        COUNT(*) FILTER (WHERE d.ipni_status IN ('${IpniStatus.SP_INDEXED}', '${IpniStatus.SP_ADVERTISED}', '${
          IpniStatus.VERIFIED
        }')) AS ipni_indexed_deals,
        COUNT(*) FILTER (WHERE d.ipni_status IN ('${IpniStatus.SP_ADVERTISED}', '${IpniStatus.VERIFIED}')) AS ipni_advertised_deals,
        COUNT(*) FILTER (WHERE d.ipni_status = '${IpniStatus.VERIFIED}') AS ipni_verified_deals,
        COUNT(*) FILTER (WHERE d.ipni_status = '${IpniStatus.FAILED}') AS ipni_failed_deals,
        ROUND(AVG(d.ipni_time_to_index_ms) FILTER (WHERE d.ipni_time_to_index_ms IS NOT NULL))::int AS avg_ipni_time_to_index_ms,
        ROUND(AVG(d.ipni_time_to_advertise_ms) FILTER (WHERE d.ipni_time_to_advertise_ms IS NOT NULL))::int AS avg_ipni_time_to_advertise_ms,
        ROUND(AVG(d.ipni_time_to_verify_ms) FILTER (WHERE d.ipni_time_to_verify_ms IS NOT NULL))::int AS avg_ipni_time_to_verify_ms,
        SUM(d.file_size) FILTER (WHERE d.status = 'deal_created') AS total_data_stored_bytes,
        MAX(d.created_at) AS last_deal_at
      FROM deals_filtered d
      GROUP BY d.sp_address
    ),
    retrievals_filtered AS (
      SELECT
        d.sp_address,
        r.service_type,
        r.status,
        r.latency_ms,
        r.ttfb_ms,
        r.throughput_bps,
        r.bytes_retrieved,
        r.created_at
      FROM retrievals r
      JOIN deals_filtered d ON d.id = r.deal_id
      ${retrievalDateFilter ? `WHERE ${retrievalDateFilter}` : ""}
    ),
    retrieval_metrics AS (
      SELECT
        r.sp_address,
        COUNT(*) FILTER (WHERE r.service_type = '${ServiceType.DIRECT_SP}') AS total_retrievals,
        COUNT(*) FILTER (WHERE r.status = 'success' AND r.service_type = '${ServiceType.DIRECT_SP}') AS successful_retrievals,
        COUNT(*) FILTER (WHERE r.status = 'failed' AND r.service_type = '${ServiceType.DIRECT_SP}') AS failed_retrievals,
        ROUND(AVG(r.latency_ms) FILTER (WHERE r.latency_ms IS NOT NULL AND r.service_type = '${
          ServiceType.DIRECT_SP
        }'))::int AS avg_retrieval_latency_ms,
        ROUND(AVG(r.ttfb_ms) FILTER (WHERE r.ttfb_ms IS NOT NULL AND r.service_type = '${
          ServiceType.DIRECT_SP
        }'))::int AS avg_retrieval_ttfb_ms,
        ROUND(AVG(r.throughput_bps) FILTER (WHERE r.throughput_bps IS NOT NULL AND r.service_type = '${
          ServiceType.DIRECT_SP
        }'))::bigint AS avg_retrieval_throughput_bps,
        COUNT(*) FILTER (WHERE r.service_type = '${ServiceType.IPFS_PIN}') AS total_ipfs_retrievals,
        COUNT(*) FILTER (WHERE r.status = 'success' AND r.service_type = '${ServiceType.IPFS_PIN}') AS successful_ipfs_retrievals,
        COUNT(*) FILTER (WHERE r.status = 'failed' AND r.service_type = '${ServiceType.IPFS_PIN}') AS failed_ipfs_retrievals,
        ROUND(AVG(r.latency_ms) FILTER (WHERE r.latency_ms IS NOT NULL AND r.service_type = '${
          ServiceType.IPFS_PIN
        }'))::int AS avg_ipfs_retrieval_latency_ms,
        ROUND(AVG(r.ttfb_ms) FILTER (WHERE r.ttfb_ms IS NOT NULL AND r.service_type = '${
          ServiceType.IPFS_PIN
        }'))::int AS avg_ipfs_retrieval_ttfb_ms,
        ROUND(AVG(r.throughput_bps) FILTER (WHERE r.throughput_bps IS NOT NULL AND r.service_type = '${
          ServiceType.IPFS_PIN
        }'))::bigint AS avg_ipfs_retrieval_throughput_bps,
        SUM(r.bytes_retrieved) FILTER (WHERE r.status = 'success' AND r.service_type = '${
          ServiceType.DIRECT_SP
        }') AS total_data_retrieved_bytes,
        SUM(r.bytes_retrieved) FILTER (WHERE r.status = 'success' AND r.service_type = '${
          ServiceType.IPFS_PIN
        }') AS total_ipfs_data_retrieved_bytes,
        MAX(r.created_at) FILTER (WHERE r.service_type = '${ServiceType.DIRECT_SP}') AS last_retrieval_at,
        MAX(r.created_at) FILTER (WHERE r.service_type = '${ServiceType.IPFS_PIN}') AS last_ipfs_retrieval_at
      FROM retrievals_filtered r
      GROUP BY r.sp_address
    )
    SELECT
      sp.address AS sp_address,
      COALESCE(dm.total_deals, 0) AS total_deals,
      COALESCE(dm.successful_deals, 0) AS successful_deals,
      COALESCE(dm.failed_deals, 0) AS failed_deals,
      CASE
        WHEN COALESCE(dm.total_deals, 0) > 0
        THEN ROUND((COALESCE(dm.successful_deals, 0)::numeric / dm.total_deals::numeric) * 100, 2)
        ELSE 0
      END AS deal_success_rate,
      dm.avg_ingest_latency_ms,
      dm.avg_chain_latency_ms,
      dm.avg_deal_latency_ms,
      dm.avg_ingest_throughput_bps,
      COALESCE(rm.total_retrievals, 0) AS total_retrievals,
      COALESCE(rm.successful_retrievals, 0) AS successful_retrievals,
      COALESCE(rm.failed_retrievals, 0) AS failed_retrievals,
      CASE
        WHEN COALESCE(rm.total_retrievals, 0) > 0
        THEN ROUND((COALESCE(rm.successful_retrievals, 0)::numeric / rm.total_retrievals::numeric) * 100, 2)
        ELSE 0
      END AS retrieval_success_rate,
      rm.avg_retrieval_latency_ms,
      rm.avg_retrieval_ttfb_ms,
      rm.avg_retrieval_throughput_bps,
      COALESCE(rm.total_ipfs_retrievals, 0) AS total_ipfs_retrievals,
      COALESCE(rm.successful_ipfs_retrievals, 0) AS successful_ipfs_retrievals,
      COALESCE(rm.failed_ipfs_retrievals, 0) AS failed_ipfs_retrievals,
      CASE
        WHEN COALESCE(rm.total_ipfs_retrievals, 0) > 0
        THEN ROUND((COALESCE(rm.successful_ipfs_retrievals, 0)::numeric / rm.total_ipfs_retrievals::numeric) * 100, 2)
        ELSE 0
      END AS ipfs_retrieval_success_rate,
      rm.avg_ipfs_retrieval_latency_ms,
      rm.avg_ipfs_retrieval_ttfb_ms,
      rm.avg_ipfs_retrieval_throughput_bps,
      COALESCE(dm.total_ipni_deals, 0) AS total_ipni_deals,
      COALESCE(dm.ipni_indexed_deals, 0) AS ipni_indexed_deals,
      COALESCE(dm.ipni_advertised_deals, 0) AS ipni_advertised_deals,
      COALESCE(dm.ipni_verified_deals, 0) AS ipni_verified_deals,
      COALESCE(dm.ipni_failed_deals, 0) AS ipni_failed_deals,
      CASE
        WHEN COALESCE(dm.total_ipni_deals, 0) > 0
        THEN ROUND((COALESCE(dm.ipni_verified_deals, 0)::numeric / dm.total_ipni_deals::numeric) * 100, 2)
        ELSE 0
      END AS ipni_success_rate,
      dm.avg_ipni_time_to_index_ms,
      dm.avg_ipni_time_to_advertise_ms,
      dm.avg_ipni_time_to_verify_ms,
      dm.total_data_stored_bytes,
      rm.total_data_retrieved_bytes,
      rm.total_ipfs_data_retrieved_bytes,
      dm.last_deal_at,
      rm.last_retrieval_at,
      rm.last_ipfs_retrieval_at,
      NOW() AS refreshed_at
    FROM storage_providers sp
    LEFT JOIN deal_metrics dm ON dm.sp_address = sp.address
    LEFT JOIN retrieval_metrics rm ON rm.sp_address = sp.address
    ORDER BY total_deals DESC NULLS LAST
  `;
}
