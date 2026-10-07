import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddUncleanedDealsDataSetIndex1791087721000 implements MigrationInterface {
  name = "AddUncleanedDealsDataSetIndex1791087721000";
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // An interrupted CONCURRENTLY build leaves an INVALID index that IF NOT EXISTS would silently
    // accept, so drop any leftover before building.
    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "IDX_deals_uncleaned_data_set"`);
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY "IDX_deals_uncleaned_data_set"
      ON deals (network, data_set_id)
      WHERE cleaned_up = false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_deals_uncleaned_data_set"`);
  }
}
