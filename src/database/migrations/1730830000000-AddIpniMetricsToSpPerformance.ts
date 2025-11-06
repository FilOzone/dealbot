import type { MigrationInterface, QueryRunner } from "typeorm";
import { ServiceType } from "../types.js";

export class AddIpniMetricsToSpPerformance1730830000000 implements MigrationInterface {
  name = "AddIpniMetricsToSpPerformance1730830000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop existing materialized views
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS sp_performance_all_time CASCADE`);
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS sp_performance_last_week CASCADE`);

    // Recreate sp_performance_all_time with IPNI metrics
    await queryRunner.query(`
      CREATE MATERIALIZED VIEW sp_performance_all_time AS
      SELECT 
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
        
        -- Retrieval metrics (all time - DIRECT_SP only)
        COUNT(DISTINCT r.id) FILTER (WHERE r.service_type = '${ServiceType.DIRECT_SP}') as total_retrievals,
        COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'success' AND r.service_type = '${ServiceType.DIRECT_SP}') as successful_retrievals,
        COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'failed' AND r.service_type = '${ServiceType.DIRECT_SP}') as failed_retrievals,
        
        -- Retrieval success rate (all time)
        CASE 
          WHEN COUNT(DISTINCT r.id) FILTER (WHERE r.service_type = '${ServiceType.DIRECT_SP}') > 0 
          THEN ROUND(
            (COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'success' AND r.service_type = '${ServiceType.DIRECT_SP}')::numeric / 
            COUNT(DISTINCT r.id) FILTER (WHERE r.service_type = '${ServiceType.DIRECT_SP}')::numeric) * 100, 
            2
          )
          ELSE 0 
        END as retrieval_success_rate,
        
        -- Retrieval latency (all time)
        ROUND(AVG(r.latency_ms) FILTER (WHERE r.latency_ms IS NOT NULL AND r.service_type = '${ServiceType.DIRECT_SP}'))::int as avg_retrieval_latency_ms,
        
        -- Retrieval TTFB (all time)
        ROUND(AVG(r.ttfb_ms) FILTER (WHERE r.ttfb_ms IS NOT NULL AND r.service_type = '${ServiceType.DIRECT_SP}'))::int as avg_retrieval_ttfb_ms,
        
        -- Retrieval throughput (all time)
        ROUND(AVG(r.throughput_bps) FILTER (WHERE r.throughput_bps IS NOT NULL AND r.service_type = '${ServiceType.DIRECT_SP}'))::bigint as avg_throughput_bps,
        
        -- IPFS retrieval metrics (all time - IPFS_PIN only)
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
        
        -- IPNI tracking metrics (all time) - incremental states: PENDING -> INDEXED -> ADVERTISED -> RETRIEVED
        COUNT(DISTINCT d.id) FILTER (WHERE d.ipni_status IS NOT NULL) as total_ipni_deals,
        COUNT(DISTINCT d.id) FILTER (WHERE d.ipni_status IN ('indexed', 'advertised', 'retrieved')) as ipni_indexed_deals,
        COUNT(DISTINCT d.id) FILTER (WHERE d.ipni_status IN ('advertised', 'retrieved')) as ipni_advertised_deals,
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
        
        -- Data volumes (all time)
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
      LEFT JOIN retrievals r ON r.deal_id = d.id AND r.service_type = '${ServiceType.DIRECT_SP}'
      LEFT JOIN retrievals r_ipfs ON r_ipfs.deal_id = d.id AND r_ipfs.service_type = '${ServiceType.IPFS_PIN}'
      GROUP BY sp.address
    `);

    // Create unique index for concurrent refresh
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_sp_performance_all_time_sp_address 
      ON sp_performance_all_time (sp_address)
    `);

    // Recreate sp_performance_last_week with IPNI metrics
    await queryRunner.query(`
      CREATE MATERIALIZED VIEW sp_performance_last_week AS
      SELECT 
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
        
        -- IPNI tracking metrics (last 7 days) - incremental states: PENDING -> INDEXED -> ADVERTISED -> RETRIEVED
        COUNT(DISTINCT d.id) FILTER (WHERE d.ipni_status IS NOT NULL) as total_ipni_deals,
        COUNT(DISTINCT d.id) FILTER (WHERE d.ipni_status IN ('indexed', 'advertised', 'retrieved')) as ipni_indexed_deals,
        COUNT(DISTINCT d.id) FILTER (WHERE d.ipni_status IN ('advertised', 'retrieved')) as ipni_advertised_deals,
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
      GROUP BY sp.address
    `);

    // Create unique index for concurrent refresh
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_sp_performance_last_week_sp_address 
      ON sp_performance_last_week (sp_address)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop materialized views with IPNI metrics
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS sp_performance_last_week CASCADE`);
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS sp_performance_all_time CASCADE`);

    // Recreate original views without IPNI metrics (from previous migration)
    await queryRunner.query(`
      CREATE MATERIALIZED VIEW sp_performance_all_time AS
      SELECT 
        sp.address as sp_address,
        COUNT(DISTINCT d.id) as total_deals,
        COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'deal_created') as successful_deals,
        COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'failed') as failed_deals,
        CASE 
          WHEN COUNT(DISTINCT d.id) > 0 
          THEN ROUND(
            (COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'deal_created')::numeric / 
            COUNT(DISTINCT d.id)::numeric) * 100, 
            2
          )
          ELSE 0 
        END as deal_success_rate,
        ROUND(AVG(d.ingest_latency_ms) FILTER (WHERE d.ingest_latency_ms IS NOT NULL))::int as avg_ingest_latency_ms,
        ROUND(AVG(d.chain_latency_ms) FILTER (WHERE d.chain_latency_ms IS NOT NULL))::int as avg_chain_latency_ms,
        ROUND(AVG(d.deal_latency_ms) FILTER (WHERE d.deal_latency_ms IS NOT NULL))::int as avg_deal_latency_ms,
        ROUND(AVG(d.ingest_throughput_bps) FILTER (WHERE d.ingest_throughput_bps IS NOT NULL))::bigint as avg_ingest_throughput_bps,
        COUNT(DISTINCT r.id) FILTER (WHERE r.service_type = '${ServiceType.DIRECT_SP}') as total_retrievals,
        COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'success' AND r.service_type = '${ServiceType.DIRECT_SP}') as successful_retrievals,
        COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'failed' AND r.service_type = '${ServiceType.DIRECT_SP}') as failed_retrievals,
        CASE 
          WHEN COUNT(DISTINCT r.id) > 0 
          THEN ROUND(
            (COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'success' AND r.service_type = '${ServiceType.DIRECT_SP}')::numeric / 
            COUNT(DISTINCT r.id) FILTER (WHERE r.service_type = '${ServiceType.DIRECT_SP}')::numeric) * 100, 
            2
          )
          ELSE 0 
        END as retrieval_success_rate,
        ROUND(AVG(r.latency_ms) FILTER (WHERE r.latency_ms IS NOT NULL AND r.service_type = '${ServiceType.DIRECT_SP}'))::int as avg_retrieval_latency_ms,
        ROUND(AVG(r.ttfb_ms) FILTER (WHERE r.ttfb_ms IS NOT NULL AND r.service_type = '${ServiceType.DIRECT_SP}'))::int as avg_retrieval_ttfb_ms,
        ROUND(AVG(r.throughput_bps) FILTER (WHERE r.throughput_bps IS NOT NULL AND r.service_type = '${ServiceType.DIRECT_SP}'))::bigint as avg_throughput_bps,
        SUM(d.file_size) FILTER (WHERE d.status = 'deal_created') as total_data_stored_bytes,
        SUM(r.bytes_retrieved) FILTER (WHERE r.status = 'success' AND r.service_type = '${ServiceType.DIRECT_SP}') as total_data_retrieved_bytes,
        MAX(d.created_at) as last_deal_at,
        MAX(r.created_at) FILTER (WHERE r.service_type = '${ServiceType.DIRECT_SP}') as last_retrieval_at,
        NOW() as refreshed_at
      FROM storage_providers sp
      LEFT JOIN deals d ON d.sp_address = sp.address
      LEFT JOIN retrievals r ON r.deal_id = d.id
      GROUP BY sp.address
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_sp_performance_all_time_sp_address 
      ON sp_performance_all_time (sp_address)
    `);
  }
}
