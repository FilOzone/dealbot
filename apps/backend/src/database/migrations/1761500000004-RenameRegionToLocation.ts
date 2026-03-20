import type { MigrationInterface, QueryRunner } from "typeorm";

export class RenameRegionToLocation1761500000004 implements MigrationInterface {
  name = "RenameRegionToLocation1761500000004";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE storage_providers RENAME COLUMN region TO location`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE storage_providers RENAME COLUMN location TO region`);
  }
}
