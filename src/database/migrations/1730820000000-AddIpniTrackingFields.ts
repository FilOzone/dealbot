import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddIpniTrackingFields1730820000000 implements MigrationInterface {
  name = "AddIpniTrackingFields1730820000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create IPNI status enum
    await queryRunner.query(`
      CREATE TYPE deals_ipni_status_enum AS ENUM (
        'pending', 
        'sp_indexed', 
        'sp_advertised', 
        'sp_received_retrieve_request',
        'verified',
        'failed'
      )
    `);

    // Add service_types array field (stored as comma-separated TEXT for simple-array)
    await queryRunner.query(`
      ALTER TABLE deals 
      ADD COLUMN IF NOT EXISTS service_types TEXT DEFAULT NULL
    `);

    // Add IPNI status field
    await queryRunner.query(`
      ALTER TABLE deals 
      ADD COLUMN IF NOT EXISTS ipni_status deals_ipni_status_enum DEFAULT NULL
    `);

    // Add IPNI tracking timestamp fields
    await queryRunner.query(`
      ALTER TABLE deals 
      ADD COLUMN IF NOT EXISTS ipni_indexed_at TIMESTAMP DEFAULT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE deals 
      ADD COLUMN IF NOT EXISTS ipni_advertised_at TIMESTAMP DEFAULT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE deals 
      ADD COLUMN IF NOT EXISTS ipni_retrieved_at TIMESTAMP DEFAULT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE deals 
      ADD COLUMN IF NOT EXISTS ipni_verified_at TIMESTAMP DEFAULT NULL
    `);

    // Add time-to-stage metrics (time from upload complete to each stage)
    await queryRunner.query(`
      ALTER TABLE deals 
      ADD COLUMN IF NOT EXISTS ipni_time_to_index_ms INTEGER DEFAULT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE deals 
      ADD COLUMN IF NOT EXISTS ipni_time_to_advertise_ms INTEGER DEFAULT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE deals 
      ADD COLUMN IF NOT EXISTS ipni_time_to_retrieve_ms INTEGER DEFAULT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE deals 
      ADD COLUMN IF NOT EXISTS ipni_time_to_verify_ms INTEGER DEFAULT NULL
    `);

    // Add IPNI verification metrics
    await queryRunner.query(`
      ALTER TABLE deals 
      ADD COLUMN IF NOT EXISTS ipni_verified_cids_count INTEGER DEFAULT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE deals 
      ADD COLUMN IF NOT EXISTS ipni_unverified_cids_count INTEGER DEFAULT NULL
    `);

    // Add indexes for IPNI tracking queries
    await queryRunner.query(`
      CREATE INDEX "IDX_deals_ipni_status" 
      ON deals (ipni_status) 
      WHERE ipni_status IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_deals_ipni_retrieved_at" 
      ON deals (ipni_retrieved_at) 
      WHERE ipni_retrieved_at IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_deals_service_types" 
      ON deals USING GIN (string_to_array(service_types, ','))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_deals_service_types"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_deals_ipni_retrieved_at"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_deals_ipni_status"
    `);

    // Drop columns
    await queryRunner.query(`
      ALTER TABLE deals 
      DROP COLUMN ipni_unverified_cids_count
    `);

    await queryRunner.query(`
      ALTER TABLE deals 
      DROP COLUMN ipni_verified_cids_count
    `);

    await queryRunner.query(`
      ALTER TABLE deals 
      DROP COLUMN ipni_time_to_verify_ms
    `);

    await queryRunner.query(`
      ALTER TABLE deals 
      DROP COLUMN ipni_time_to_retrieve_ms
    `);

    await queryRunner.query(`
      ALTER TABLE deals 
      DROP COLUMN ipni_time_to_advertise_ms
    `);

    await queryRunner.query(`
      ALTER TABLE deals 
      DROP COLUMN ipni_time_to_index_ms
    `);

    await queryRunner.query(`
      ALTER TABLE deals 
      DROP COLUMN ipni_verified_at
    `);

    await queryRunner.query(`
      ALTER TABLE deals 
      DROP COLUMN ipni_retrieved_at
    `);

    await queryRunner.query(`
      ALTER TABLE deals 
      DROP COLUMN ipni_advertised_at
    `);

    await queryRunner.query(`
      ALTER TABLE deals 
      DROP COLUMN ipni_indexed_at
    `);

    await queryRunner.query(`
      ALTER TABLE deals 
      DROP COLUMN ipni_status
    `);

    await queryRunner.query(`
      ALTER TABLE deals 
      DROP COLUMN service_types
    `);

    // Drop enum type
    await queryRunner.query(`
      DROP TYPE deals_ipni_status_enum
    `);
  }
}
