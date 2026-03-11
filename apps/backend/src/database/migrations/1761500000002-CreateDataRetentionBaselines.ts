import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateDataRetentionBaselines1761500000002 implements MigrationInterface {
  name = "CreateDataRetentionBaselines1761500000002";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS data_retention_baselines (
        provider_address TEXT PRIMARY KEY,
        faulted_periods BIGINT NOT NULL,
        success_periods BIGINT NOT NULL,
        last_block_number BIGINT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS data_retention_baselines`);
  }
}
