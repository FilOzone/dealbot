import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSpPerformanceMaterializedViews1730000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create helper function to refresh weekly view
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION refresh_sp_performance_last_week()
      RETURNS void AS $$
      BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY sp_performance_last_week;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Create helper function to refresh all-time view
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
    // Drop helper functions
    await queryRunner.query(`DROP FUNCTION IF EXISTS refresh_sp_performance_weekly();`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS refresh_sp_performance_all_time();`);
  }
}
