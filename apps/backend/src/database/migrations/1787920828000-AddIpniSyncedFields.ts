import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddIpniSyncedFields1787920828000 implements MigrationInterface {
  name = "AddIpniSyncedFields1787920828000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Postgres cannot drop enum values, so this cannot be undone in down().
    await queryRunner.query(`
      ALTER TYPE deals_ipni_status_enum ADD VALUE IF NOT EXISTS 'sp_synced' BEFORE 'verified'
    `);

    await queryRunner.query(`
      ALTER TABLE deals
      ADD COLUMN IF NOT EXISTS ipni_synced_at TIMESTAMP DEFAULT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE deals
      ADD COLUMN IF NOT EXISTS ipni_time_to_sync_ms INTEGER DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE deals
      DROP COLUMN IF EXISTS ipni_time_to_sync_ms
    `);

    await queryRunner.query(`
      ALTER TABLE deals
      DROP COLUMN IF EXISTS ipni_synced_at
    `);
  }
}
