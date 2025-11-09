import { IpniStatus, ServiceType } from "../types.js";

/**
 * Generate SQL query for SP performance materialized view
 * @param dateFilter - Optional date filter for deals (e.g., "d.created_at >= NOW() - INTERVAL '7 days'")
 * @returns SQL query string
 */
export function generateSpPerformanceQuery(dateFilter?: string): string {
  return `
    SELECT 
      sp.address as sp_address,
      
      -- Deal metrics
      COUNT(DISTINCT d.id) as total_deals,
      COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'deal_created') as successful_deals,
      COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'failed') as failed_deals,
      
      -- Deal success rate
      CASE 
        WHEN COUNT(DISTINCT d.id) > 0 
        THEN ROUND(
          (COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'deal_created')::numeric / 
          COUNT(DISTINCT d.id)::numeric) * 100, 
          2
        )
        ELSE 0 
      END as deal_success_rate,
      
      -- Deal latency metrics
      ROUND(AVG(d.ingest_latency_ms) FILTER (WHERE d.ingest_latency_ms IS NOT NULL))::int as avg_ingest_latency_ms,
      ROUND(AVG(d.chain_latency_ms) FILTER (WHERE d.chain_latency_ms IS NOT NULL))::int as avg_chain_latency_ms,
      ROUND(AVG(d.deal_latency_ms) FILTER (WHERE d.deal_latency_ms IS NOT NULL))::int as avg_deal_latency_ms,
      
      -- Deal throughput
      ROUND(AVG(d.ingest_throughput_bps) FILTER (WHERE d.ingest_throughput_bps IS NOT NULL))::bigint as avg_ingest_throughput_bps,
      
      -- Retrieval metrics (DIRECT_SP only)
      COUNT(DISTINCT r.id) FILTER (WHERE r.service_type = '${ServiceType.DIRECT_SP}') as total_retrievals,
      COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'success' AND r.service_type = '${
        ServiceType.DIRECT_SP
      }') as successful_retrievals,
      COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'failed' AND r.service_type = '${
        ServiceType.DIRECT_SP
      }') as failed_retrievals,
      
      -- Retrieval success rate
      CASE 
        WHEN COUNT(DISTINCT r.id) FILTER (WHERE r.service_type = '${ServiceType.DIRECT_SP}') > 0 
        THEN ROUND(
          (COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'success' AND r.service_type = '${
            ServiceType.DIRECT_SP
          }')::numeric / 
          COUNT(DISTINCT r.id) FILTER (WHERE r.service_type = '${ServiceType.DIRECT_SP}')::numeric) * 100, 
          2
        )
        ELSE 0 
      END as retrieval_success_rate,
      
      -- Retrieval latency
      ROUND(AVG(r.latency_ms) FILTER (WHERE r.latency_ms IS NOT NULL AND r.service_type = '${
        ServiceType.DIRECT_SP
      }'))::int as avg_retrieval_latency_ms,
      ROUND(AVG(r.ttfb_ms) FILTER (WHERE r.ttfb_ms IS NOT NULL AND r.service_type = '${
        ServiceType.DIRECT_SP
      }'))::int as avg_retrieval_ttfb_ms,
      ROUND(AVG(r.throughput_bps) FILTER (WHERE r.throughput_bps IS NOT NULL AND r.service_type = '${
        ServiceType.DIRECT_SP
      }'))::bigint as avg_retrieval_throughput_bps,
      
      -- IPFS retrieval metrics
      COUNT(DISTINCT r_ipfs.id) FILTER (WHERE r_ipfs.service_type = '${ServiceType.IPFS_PIN}') as total_ipfs_retrievals,
      COUNT(DISTINCT r_ipfs.id) FILTER (WHERE r_ipfs.status = 'success' AND r_ipfs.service_type = '${
        ServiceType.IPFS_PIN
      }') as successful_ipfs_retrievals,
      COUNT(DISTINCT r_ipfs.id) FILTER (WHERE r_ipfs.status = 'failed' AND r_ipfs.service_type = '${
        ServiceType.IPFS_PIN
      }') as failed_ipfs_retrievals,
      
      -- IPFS retrieval success rate
      CASE 
        WHEN COUNT(DISTINCT r_ipfs.id) FILTER (WHERE r_ipfs.service_type = '${ServiceType.IPFS_PIN}') > 0 
        THEN ROUND(
          (COUNT(DISTINCT r_ipfs.id) FILTER (WHERE r_ipfs.status = 'success' AND r_ipfs.service_type = '${
            ServiceType.IPFS_PIN
          }')::numeric / 
          COUNT(DISTINCT r_ipfs.id) FILTER (WHERE r_ipfs.service_type = '${ServiceType.IPFS_PIN}')::numeric) * 100, 
          2
        )
        ELSE 0 
      END as ipfs_retrieval_success_rate,
      
      -- IPFS retrieval performance
      ROUND(AVG(r_ipfs.latency_ms) FILTER (WHERE r_ipfs.latency_ms IS NOT NULL AND r_ipfs.service_type = '${
        ServiceType.IPFS_PIN
      }'))::int as avg_ipfs_retrieval_latency_ms,
      ROUND(AVG(r_ipfs.ttfb_ms) FILTER (WHERE r_ipfs.ttfb_ms IS NOT NULL AND r_ipfs.service_type = '${
        ServiceType.IPFS_PIN
      }'))::int as avg_ipfs_retrieval_ttfb_ms,
      ROUND(AVG(r_ipfs.throughput_bps) FILTER (WHERE r_ipfs.throughput_bps IS NOT NULL AND r_ipfs.service_type = '${
        ServiceType.IPFS_PIN
      }'))::bigint as avg_ipfs_retrieval_throughput_bps,
      
      -- IPNI tracking metrics - incremental states: PENDING -> SP_INDEXED -> SP_ADVERTISED -> SP_RECEIVED_RETRIEVE_REQUEST -> VERIFIED
      COUNT(DISTINCT d.id) FILTER (WHERE d.ipni_status IS NOT NULL) as total_ipni_deals,
      COUNT(DISTINCT d.id) FILTER (WHERE d.ipni_status IN ('${IpniStatus.SP_INDEXED}', '${
    IpniStatus.SP_ADVERTISED
  }', '${IpniStatus.SP_RECEIVED_RETRIEVE_REQUEST}', '${IpniStatus.VERIFIED}')) as ipni_indexed_deals,
      COUNT(DISTINCT d.id) FILTER (WHERE d.ipni_status IN ('${IpniStatus.SP_ADVERTISED}', '${
    IpniStatus.SP_RECEIVED_RETRIEVE_REQUEST
  }', '${IpniStatus.VERIFIED}')) as ipni_advertised_deals,
      COUNT(DISTINCT d.id) FILTER (WHERE d.ipni_status IN ('${IpniStatus.SP_RECEIVED_RETRIEVE_REQUEST}', '${
    IpniStatus.VERIFIED
  }')) as ipni_retrieved_deals,
      COUNT(DISTINCT d.id) FILTER (WHERE d.ipni_status = '${IpniStatus.VERIFIED}') as ipni_verified_deals,
      COUNT(DISTINCT d.id) FILTER (WHERE d.ipni_status = '${IpniStatus.FAILED}') as ipni_failed_deals,
      
      -- IPNI success rate (based on verified status)
      CASE 
        WHEN COUNT(DISTINCT d.id) FILTER (WHERE d.ipni_status IS NOT NULL) > 0 
        THEN ROUND(
          (COUNT(DISTINCT d.id) FILTER (WHERE d.ipni_status = '${IpniStatus.VERIFIED}')::numeric / 
          COUNT(DISTINCT d.id) FILTER (WHERE d.ipni_status IS NOT NULL)::numeric) * 100, 
          2
        )
        ELSE 0 
      END as ipni_success_rate,
      
      -- IPNI performance metrics
      ROUND(AVG(d.ipni_time_to_index_ms) FILTER (WHERE d.ipni_time_to_index_ms IS NOT NULL))::int as avg_ipni_time_to_index_ms,
      ROUND(AVG(d.ipni_time_to_advertise_ms) FILTER (WHERE d.ipni_time_to_advertise_ms IS NOT NULL))::int as avg_ipni_time_to_advertise_ms,
      ROUND(AVG(d.ipni_time_to_retrieve_ms) FILTER (WHERE d.ipni_time_to_retrieve_ms IS NOT NULL))::int as avg_ipni_time_to_retrieve_ms,
      ROUND(AVG(d.ipni_time_to_verify_ms) FILTER (WHERE d.ipni_time_to_verify_ms IS NOT NULL))::int as avg_ipni_time_to_verify_ms,
      
      -- Data volumes
      SUM(d.file_size) FILTER (WHERE d.status = 'deal_created') as total_data_stored_bytes,
      SUM(r.bytes_retrieved) FILTER (WHERE r.status = 'success' AND r.service_type = '${
        ServiceType.DIRECT_SP
      }') as total_data_retrieved_bytes,
      SUM(r_ipfs.bytes_retrieved) FILTER (WHERE r_ipfs.status = 'success' AND r_ipfs.service_type = '${
        ServiceType.IPFS_PIN
      }') as total_ipfs_data_retrieved_bytes,
      
      -- Last activity timestamps
      MAX(d.created_at) as last_deal_at,
      MAX(r.created_at) FILTER (WHERE r.service_type = '${ServiceType.DIRECT_SP}') as last_retrieval_at,
      MAX(r_ipfs.created_at) FILTER (WHERE r_ipfs.service_type = '${ServiceType.IPFS_PIN}') as last_ipfs_retrieval_at,
      NOW() as refreshed_at
      
    FROM storage_providers sp
    LEFT JOIN deals d ON d.sp_address = sp.address ${dateFilter ? `AND ${dateFilter}` : ""}
    LEFT JOIN retrievals r ON r.deal_id = d.id ${
      dateFilter ? `AND ${dateFilter.replace("d.created_at", "r.created_at")}` : ""
    }
    LEFT JOIN retrievals r_ipfs ON r_ipfs.deal_id = d.id ${
      dateFilter ? `AND ${dateFilter.replace("d.created_at", "r_ipfs.created_at")}` : ""
    }
    GROUP BY sp.address
    ORDER BY total_deals DESC NULLS LAST
  `;
}
