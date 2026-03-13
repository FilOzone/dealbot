import type { MigrationInterface, QueryRunner } from "typeorm";

export class RenameRegionToLocation1761500000004 implements MigrationInterface {
  name = "RenameRegionToLocation1761500000004";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE TABLE storage_providers ALTER COLUMN region RENAME TO location`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE TABLE storage_providers ALTER COLUMN location RENAME TO region`);
  }
}
