import type { MigrationInterface, QueryRunner } from "typeorm";
import { generateSpPerformanceQuery } from "../helpers/sp-performance-query.helper.js";

export class RemoveCdnServiceType1760600000000 implements MigrationInterface {
  name = "RemoveCdnServiceType1760600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop materialized views that depend on retrievals.service_type before altering enums.
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS sp_performance_all_time CASCADE`);
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS sp_performance_last_week CASCADE`);

    // Remove legacy CDN data before dropping the enum value.
    // NOTE: metrics tables are going away soon; see
    // https://github.com/FilOzone/dealbot/pull/228 and https://github.com/FilOzone/dealbot/pull/164.
    await queryRunner.query(`DELETE FROM retrievals WHERE service_type = 'cdn'`);
    await queryRunner.query(`DELETE FROM metrics_daily WHERE service_type = 'cdn'`);
    await queryRunner.query(`
      UPDATE deals
      SET metadata = metadata - 'cdnMetadata'
      WHERE metadata ? 'cdnMetadata'
    `);
    await queryRunner.query(`
      UPDATE deals
      SET service_types = array_to_string(array_remove(string_to_array(service_types, ','), 'cdn'), ',')
      WHERE service_types IS NOT NULL
    `);
    await queryRunner.query(`UPDATE deals SET service_types = NULL WHERE service_types = ''`);

    await queryRunner.query(`ALTER TABLE retrievals ALTER COLUMN service_type DROP DEFAULT`);
    await queryRunner.query(`ALTER TYPE retrievals_service_type_enum RENAME TO retrievals_service_type_enum_old`);
    await queryRunner.query(`CREATE TYPE retrievals_service_type_enum AS ENUM ('direct_sp', 'ipfs_pin')`);
    await queryRunner.query(`
      ALTER TABLE retrievals
      ALTER COLUMN service_type TYPE retrievals_service_type_enum
      USING service_type::text::retrievals_service_type_enum
    `);
    await queryRunner.query(`ALTER TABLE retrievals ALTER COLUMN service_type SET DEFAULT 'direct_sp'`);
    await queryRunner.query(`DROP TYPE retrievals_service_type_enum_old`);

    await queryRunner.query(`ALTER TYPE metrics_daily_service_type_enum RENAME TO metrics_daily_service_type_enum_old`);
    await queryRunner.query(`CREATE TYPE metrics_daily_service_type_enum AS ENUM ('direct_sp', 'ipfs_pin')`);
    await queryRunner.query(`
      ALTER TABLE metrics_daily
      ALTER COLUMN service_type TYPE metrics_daily_service_type_enum
      USING service_type::text::metrics_daily_service_type_enum
    `);
    await queryRunner.query(`DROP TYPE metrics_daily_service_type_enum_old`);

    // Recreate materialized views and refresh helpers after enum changes.
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
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION refresh_sp_performance_last_week()
      RETURNS void AS $$
      BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY sp_performance_last_week;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION refresh_sp_performance_all_time()
      RETURNS void AS $$
      BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY sp_performance_all_time;
      END;
      $$ LANGUAGE plpgsql;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop materialized views so the enum can be reverted.
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS sp_performance_last_week CASCADE`);
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS sp_performance_all_time CASCADE`);

    await queryRunner.query(`ALTER TABLE retrievals ALTER COLUMN service_type DROP DEFAULT`);
    await queryRunner.query(`ALTER TYPE retrievals_service_type_enum RENAME TO retrievals_service_type_enum_old`);
    await queryRunner.query(`CREATE TYPE retrievals_service_type_enum AS ENUM ('direct_sp', 'cdn', 'ipfs_pin')`);
    await queryRunner.query(`
      ALTER TABLE retrievals
      ALTER COLUMN service_type TYPE retrievals_service_type_enum
      USING service_type::text::retrievals_service_type_enum
    `);
    await queryRunner.query(`ALTER TABLE retrievals ALTER COLUMN service_type SET DEFAULT 'direct_sp'`);
    await queryRunner.query(`DROP TYPE retrievals_service_type_enum_old`);

    await queryRunner.query(`ALTER TYPE metrics_daily_service_type_enum RENAME TO metrics_daily_service_type_enum_old`);
    await queryRunner.query(`CREATE TYPE metrics_daily_service_type_enum AS ENUM ('direct_sp', 'cdn', 'ipfs_pin')`);
    await queryRunner.query(`
      ALTER TABLE metrics_daily
      ALTER COLUMN service_type TYPE metrics_daily_service_type_enum
      USING service_type::text::metrics_daily_service_type_enum
    `);
    await queryRunner.query(`DROP TYPE metrics_daily_service_type_enum_old`);

    // Recreate materialized views and refresh helpers after enum changes.
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
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION refresh_sp_performance_last_week()
      RETURNS void AS $$
      BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY sp_performance_last_week;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION refresh_sp_performance_all_time()
      RETURNS void AS $$
      BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY sp_performance_all_time;
      END;
      $$ LANGUAGE plpgsql;
    `);
  }
}
