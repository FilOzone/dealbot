import type { MigrationInterface, QueryRunner } from "typeorm";
import { generateSpPerformanceQuery } from "../helpers/sp-performance-query.helper.js";

export class RemoveIpniRetrievedColumns1761500000001 implements MigrationInterface {
  name = "RemoveIpniRetrievedColumns1761500000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop materialized views (they reference columns being removed)
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS sp_performance_all_time CASCADE`);
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS sp_performance_last_week CASCADE`);

    // 2. Drop ipni_retrieved_at column and its index from deals
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_deals_ipni_retrieved_at"`);
    await queryRunner.query(`ALTER TABLE deals DROP COLUMN IF EXISTS ipni_retrieved_at`);

    // 3. Drop ipni_time_to_retrieve_ms column from deals
    await queryRunner.query(`ALTER TABLE deals DROP COLUMN IF EXISTS ipni_time_to_retrieve_ms`);

    // 4. Drop avg_ipni_time_to_retrieve_ms column from metrics_daily
    await queryRunner.query(`ALTER TABLE metrics_daily DROP COLUMN IF EXISTS avg_ipni_time_to_retrieve_ms`);

    // 5. Recreate materialized views
    await queryRunner.query(`
      CREATE MATERIALIZED VIEW sp_performance_all_time AS
      ${generateSpPerformanceQuery()}
    `);
    await queryRunner.query(`
      CREATE MATERIALIZED VIEW sp_performance_last_week AS
      ${generateSpPerformanceQuery("d.created_at >= NOW() - INTERVAL '7 days'")}
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_sp_performance_all_time_sp_address
      ON sp_performance_all_time (sp_address)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_sp_performance_last_week_sp_address
      ON sp_performance_last_week (sp_address)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop materialized views
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS sp_performance_all_time CASCADE`);
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS sp_performance_last_week CASCADE`);

    // 2. Add back ipni_retrieved_at column and index
    await queryRunner.query(`ALTER TABLE deals ADD COLUMN ipni_retrieved_at TIMESTAMP`);
    await queryRunner.query(`
      CREATE INDEX "IDX_deals_ipni_retrieved_at"
      ON deals (ipni_retrieved_at)
      WHERE ipni_retrieved_at IS NOT NULL
    `);

    // 3. Add back ipni_time_to_retrieve_ms column
    await queryRunner.query(`ALTER TABLE deals ADD COLUMN ipni_time_to_retrieve_ms INTEGER`);

    // 4. Add back avg_ipni_time_to_retrieve_ms column
    await queryRunner.query(`ALTER TABLE metrics_daily ADD COLUMN avg_ipni_time_to_retrieve_ms INTEGER`);

    // 5. Recreate materialized views
    await queryRunner.query(`
      CREATE MATERIALIZED VIEW sp_performance_all_time AS
      ${generateSpPerformanceQuery()}
    `);
    await queryRunner.query(`
      CREATE MATERIALIZED VIEW sp_performance_last_week AS
      ${generateSpPerformanceQuery("d.created_at >= NOW() - INTERVAL '7 days'")}
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_sp_performance_all_time_sp_address
      ON sp_performance_all_time (sp_address)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_sp_performance_last_week_sp_address
      ON sp_performance_last_week (sp_address)
    `);
  }
}
