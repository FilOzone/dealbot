import type { MigrationInterface, QueryRunner } from "typeorm";

export class RenameEvents1761500000003 implements MigrationInterface {
  name = "RenameEvents1761500000003";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE TABLE deals ALTER COLUMN piece_added_time RENAME TO pieces_added_time`);
    await queryRunner.query(`UPDATE TABLE deals ALTER COLUMN piece_confirmed_time RENAME TO pieces_confirmed_time`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE TABLE deals ALTER COLUMN pieces_added_time RENAME TO piece_added_time`);
    await queryRunner.query(`UPDATE TABLE deals ALTER COLUMN pieces_confirmed_time RENAME TO piece_confirmed_time`);
  }
}
