import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateInitialTables1720000000000 implements MigrationInterface {
  name = "CreateInitialTables1720000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum types
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE deals_status_enum AS ENUM ('pending', 'uploaded', 'piece_added', 'deal_created', 'failed');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE retrievals_service_type_enum AS ENUM ('direct_sp', 'cdn', 'ipfs_pin');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE retrievals_status_enum AS ENUM ('pending', 'in_progress', 'success', 'failed', 'timeout');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE metrics_daily_service_type_enum AS ENUM ('direct_sp', 'cdn', 'ipfs_pin');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create storage_providers table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS storage_providers (
        address VARCHAR NOT NULL PRIMARY KEY,
        "providerId" INTEGER,
        name VARCHAR NOT NULL,
        description VARCHAR NOT NULL,
        payee VARCHAR NOT NULL,
        service_url VARCHAR,
        is_active BOOLEAN NOT NULL DEFAULT true,
        is_approved BOOLEAN NOT NULL DEFAULT false,
        region VARCHAR NOT NULL,
        metadata JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Create index on storage_providers
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_storage_providers_region_is_active"
      ON storage_providers (region, is_active)
    `);

    // Create deals table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS deals (
        id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
        sp_address VARCHAR NOT NULL,
        wallet_address VARCHAR NOT NULL,
        file_name VARCHAR NOT NULL,
        file_size BIGINT NOT NULL,
        piece_cid VARCHAR,
        data_set_id INTEGER,
        piece_id INTEGER,
        piece_size BIGINT,
        status deals_status_enum NOT NULL DEFAULT 'pending',
        transaction_hash VARCHAR,
        metadata JSONB NOT NULL DEFAULT '{}',
        upload_start_time TIMESTAMP,
        upload_end_time TIMESTAMP,
        piece_added_time TIMESTAMP,
        deal_confirmed_time TIMESTAMP,
        ingest_latency_ms INTEGER,
        chain_latency_ms INTEGER,
        deal_latency_ms INTEGER,
        ingest_throughput_bps INTEGER,
        error_message TEXT,
        error_code VARCHAR,
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "FK_deals_storage_providers" FOREIGN KEY (sp_address)
          REFERENCES storage_providers(address) ON DELETE CASCADE
      )
    `);

    // Create indexes on deals
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_deals_sp_address"
      ON deals (sp_address)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_deals_status"
      ON deals (status)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_deals_created_at"
      ON deals (created_at)
    `);

    // Create retrievals table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS retrievals (
        id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
        deal_id UUID NOT NULL,
        service_type retrievals_service_type_enum NOT NULL DEFAULT 'direct_sp',
        retrieval_endpoint VARCHAR NOT NULL,
        status retrievals_status_enum NOT NULL DEFAULT 'pending',
        started_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        latency_ms INTEGER,
        throughput_bps INTEGER,
        bytes_retrieved INTEGER,
        ttfb_ms INTEGER,
        response_code INTEGER,
        error_message VARCHAR,
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "FK_retrievals_deals" FOREIGN KEY (deal_id)
          REFERENCES deals(id) ON DELETE CASCADE
      )
    `);

    // Create indexes on retrievals
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_retrievals_deal_id"
      ON retrievals (deal_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_retrievals_service_type"
      ON retrievals (service_type)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_retrievals_status"
      ON retrievals (status)
    `);

    // Create metrics_daily table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS metrics_daily (
        id SERIAL NOT NULL PRIMARY KEY,
        daily_bucket TIMESTAMPTZ NOT NULL,
        sp_address VARCHAR,
        service_type metrics_daily_service_type_enum,
        total_deals INTEGER NOT NULL DEFAULT 0,
        successful_deals INTEGER NOT NULL DEFAULT 0,
        failed_deals INTEGER NOT NULL DEFAULT 0,
        deal_success_rate FLOAT,
        avg_ingest_latency_ms FLOAT,
        avg_ingest_throughput_bps FLOAT,
        avg_chain_latency_ms FLOAT,
        avg_deal_latency_ms INTEGER,
        total_data_stored_bytes BIGINT NOT NULL DEFAULT 0,
        total_retrievals INTEGER NOT NULL DEFAULT 0,
        successful_retrievals INTEGER NOT NULL DEFAULT 0,
        failed_retrievals INTEGER NOT NULL DEFAULT 0,
        retrieval_success_rate FLOAT,
        avg_retrieval_latency_ms INTEGER,
        avg_retrieval_ttfb_ms INTEGER,
        avg_retrieval_throughput_bps INTEGER,
        total_data_retrieved_bytes BIGINT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "UQ_metrics_daily_daily_bucket_sp_address_service_type"
          UNIQUE (daily_bucket, sp_address, service_type),
        CONSTRAINT "FK_metrics_daily_storage_providers" FOREIGN KEY (sp_address)
          REFERENCES storage_providers(address) ON DELETE CASCADE
      )
    `);

    // Create indexes on metrics_daily
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_metrics_daily_daily_bucket"
      ON metrics_daily (daily_bucket)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_metrics_daily_sp_address_daily_bucket"
      ON metrics_daily (sp_address, daily_bucket)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_metrics_daily_service_type_daily_bucket"
      ON metrics_daily (service_type, daily_bucket)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables in reverse order (due to foreign keys)
    await queryRunner.query(`DROP TABLE IF EXISTS metrics_daily CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS retrievals CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS deals CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS storage_providers CASCADE`);

    // Drop enum types
    await queryRunner.query(`DROP TYPE IF EXISTS metrics_daily_service_type_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS retrievals_status_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS retrievals_service_type_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS deals_status_enum`);
  }
}
