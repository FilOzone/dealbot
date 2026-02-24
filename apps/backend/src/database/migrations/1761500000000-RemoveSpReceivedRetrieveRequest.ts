import type { MigrationInterface, QueryRunner } from "typeorm";
import { generateSpPerformanceQuery } from "../helpers/sp-performance-query.helper.js";

export class RemoveSpReceivedRetrieveRequest1761500000000 implements MigrationInterface {
  name = "RemoveSpReceivedRetrieveRequest1761500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop materialized views (they reference the enum value being removed)
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS sp_performance_all_time CASCADE`);
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS sp_performance_last_week CASCADE`);

    // 2. Update any deals with ipni_status = 'sp_received_retrieve_request' to 'sp_advertised'
    await queryRunner.query(`
      UPDATE deals SET ipni_status = 'sp_advertised'
      WHERE ipni_status = 'sp_received_retrieve_request'
    `);

    // 3. Remove 'sp_received_retrieve_request' from deals_ipni_status_enum
    await queryRunner.query(`
      CREATE TYPE deals_ipni_status_enum_new AS ENUM ('pending', 'sp_indexed', 'sp_advertised', 'verified', 'failed')
    `);
    await queryRunner.query(`
      ALTER TABLE deals
        ALTER COLUMN ipni_status TYPE deals_ipni_status_enum_new
        USING ipni_status::text::deals_ipni_status_enum_new
    `);
    await queryRunner.query(`DROP TYPE deals_ipni_status_enum`);
    await queryRunner.query(`ALTER TYPE deals_ipni_status_enum_new RENAME TO deals_ipni_status_enum`);

    // 4. Drop ipni_retrieved_deals column from metrics_daily
    await queryRunner.query(`ALTER TABLE metrics_daily DROP COLUMN IF EXISTS ipni_retrieved_deals`);

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

    // 2. Add back ipni_retrieved_deals column
    await queryRunner.query(`ALTER TABLE metrics_daily ADD COLUMN ipni_retrieved_deals integer NOT NULL DEFAULT 0`);

    // 3. Add back 'sp_received_retrieve_request' to enum
    await queryRunner.query(`
      CREATE TYPE deals_ipni_status_enum_new AS ENUM ('pending', 'sp_indexed', 'sp_advertised', 'sp_received_retrieve_request', 'verified', 'failed')
    `);
    await queryRunner.query(`
      ALTER TABLE deals
        ALTER COLUMN ipni_status TYPE deals_ipni_status_enum_new
        USING ipni_status::text::deals_ipni_status_enum_new
    `);
    await queryRunner.query(`DROP TYPE deals_ipni_status_enum`);
    await queryRunner.query(`ALTER TYPE deals_ipni_status_enum_new RENAME TO deals_ipni_status_enum`);

    // 4. Recreate materialized views (will use current helper which no longer has the old columns,
    //    but down() is best-effort; views will be recreated on next migration up)
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
