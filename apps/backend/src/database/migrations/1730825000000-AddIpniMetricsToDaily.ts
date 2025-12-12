import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddIpniMetricsToDaily1730825000000 implements MigrationInterface {
  name = "AddIpniMetricsToDaily1730825000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add IPNI tracking metrics to metrics_daily table
    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      ADD COLUMN IF NOT EXISTS total_ipni_deals INTEGER DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      ADD COLUMN IF NOT EXISTS ipni_indexed_deals INTEGER DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      ADD COLUMN IF NOT EXISTS ipni_advertised_deals INTEGER DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      ADD COLUMN IF NOT EXISTS ipni_retrieved_deals INTEGER DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      ADD COLUMN IF NOT EXISTS ipni_verified_deals INTEGER DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      ADD COLUMN IF NOT EXISTS ipni_failed_deals INTEGER DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      ADD COLUMN IF NOT EXISTS ipni_success_rate FLOAT DEFAULT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      ADD COLUMN IF NOT EXISTS avg_ipni_time_to_index_ms INTEGER DEFAULT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      ADD COLUMN IF NOT EXISTS avg_ipni_time_to_advertise_ms INTEGER DEFAULT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      ADD COLUMN IF NOT EXISTS avg_ipni_time_to_retrieve_ms INTEGER DEFAULT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      ADD COLUMN IF NOT EXISTS avg_ipni_time_to_verify_ms INTEGER DEFAULT NULL
    `);

    // Add index for IPNI queries
    await queryRunner.query(`
      CREATE INDEX "IDX_metrics_daily_ipni_success_rate" 
      ON metrics_daily (ipni_success_rate) 
      WHERE ipni_success_rate IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop index
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_metrics_daily_ipni_success_rate"
    `);

    // Drop columns
    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      DROP COLUMN avg_ipni_time_to_verify_ms
    `);

    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      DROP COLUMN avg_ipni_time_to_retrieve_ms
    `);

    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      DROP COLUMN avg_ipni_time_to_advertise_ms
    `);

    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      DROP COLUMN avg_ipni_time_to_index_ms
    `);

    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      DROP COLUMN ipni_success_rate
    `);

    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      DROP COLUMN ipni_failed_deals
    `);

    await queryRunner.query(`
      ALTER TABLE metrics_daily
      DROP COLUMN ipni_verified_deals
    `);

    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      DROP COLUMN ipni_retrieved_deals
    `);

    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      DROP COLUMN ipni_advertised_deals
    `);

    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      DROP COLUMN ipni_indexed_deals
    `);

    await queryRunner.query(`
      ALTER TABLE metrics_daily 
      DROP COLUMN total_ipni_deals
    `);
  }
}
