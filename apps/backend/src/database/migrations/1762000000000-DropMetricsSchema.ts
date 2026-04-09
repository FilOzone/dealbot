import type { MigrationInterface, QueryRunner } from "typeorm";

export class DropMetricsSchema1762000000000 implements MigrationInterface {
  name = "DropMetricsSchema1762000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop refresh functions first (they reference the materialized views)
    await queryRunner.query(`DROP FUNCTION IF EXISTS refresh_sp_performance_last_week()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS refresh_sp_performance_all_time()`);

    // Drop materialized views
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS sp_performance_last_week`);
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS sp_performance_all_time`);

    // Drop metrics_daily table
    await queryRunner.query(`DROP TABLE IF EXISTS metrics_daily CASCADE`);

    // Drop enums created by TypeORM for metrics_daily columns
    await queryRunner.query(`DROP TYPE IF EXISTS metrics_daily_metric_type_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS metrics_daily_service_type_enum`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Irreversible: Restore from backup if rollback is needed.
  }
}
