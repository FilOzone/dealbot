import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddPieceCleanupColumns1761500000002 implements MigrationInterface {
  name = "AddPieceCleanupColumns1761500000002";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE deals
        ADD COLUMN IF NOT EXISTS cleaned_up BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS cleaned_up_at TIMESTAMPTZ NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE deals DROP COLUMN IF EXISTS cleaned_up_at`);
    await queryRunner.query(`ALTER TABLE deals DROP COLUMN IF EXISTS cleaned_up`);
  }
}
