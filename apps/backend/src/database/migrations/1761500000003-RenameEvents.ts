import type { MigrationInterface, QueryRunner } from "typeorm";

export class RenameEvents1761500000003 implements MigrationInterface {
  name = "RenameEvents1761500000003";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE deals RENAME COLUMN piece_added_time TO pieces_added_time`);
    await queryRunner.query(`ALTER TABLE deals RENAME COLUMN piece_confirmed_time TO pieces_confirmed_time`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE deals RENAME COLUMN pieces_added_time TO piece_added_time`);
    await queryRunner.query(`ALTER TABLE deals RENAME COLUMN pieces_confirmed_time TO piece_confirmed_time`);
  }
}
