import type { MigrationInterface, QueryRunner } from "typeorm";
import { generateSpPerformanceQuery } from "../helpers/sp-performance-query.helper.js";

export class AddIpniMetricsToSpPerformance1730830000000 implements MigrationInterface {
  name = "AddIpniMetricsToSpPerformance1730830000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop existing materialized views
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS sp_performance_all_time CASCADE`);
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS sp_performance_last_week CASCADE`);

    // Create sp_performance_all_time with IPNI metrics (no date filter)
    await queryRunner.query(`
      CREATE MATERIALIZED VIEW sp_performance_all_time AS
      ${generateSpPerformanceQuery()}
    `);

    // Create sp_performance_last_week with IPNI metrics (7 day filter)
    await queryRunner.query(`
      CREATE MATERIALIZED VIEW sp_performance_last_week AS
      ${generateSpPerformanceQuery("d.created_at >= NOW() - INTERVAL '7 days'")}
    `);

    // Create unique indexes for both views
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
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS sp_performance_last_week CASCADE`);
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS sp_performance_all_time CASCADE`);
  }
}
