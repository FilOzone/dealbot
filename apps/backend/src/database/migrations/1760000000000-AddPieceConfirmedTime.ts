import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddPieceConfirmedTime1760000000000 implements MigrationInterface {
  name = "AddPieceConfirmedTime1760000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE deals
      ADD COLUMN IF NOT EXISTS piece_confirmed_time TIMESTAMP DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE deals
      DROP COLUMN IF EXISTS piece_confirmed_time
    `);
  }
}
