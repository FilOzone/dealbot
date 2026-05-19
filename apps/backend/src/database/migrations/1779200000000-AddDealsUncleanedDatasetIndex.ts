import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Partial index supporting the dataset_cleanup_sweep job and the
 * piece-cleanup / retrieval candidate selectors that filter on
 * `cleaned_up = false`.
 *
 * Without this index, `SELECT DISTINCT data_set_id WHERE cleaned_up = false`
 * triggers a full table scan of `deals` on every sweep tick.
 */
export class AddDealsUncleanedDatasetIndex1779200000000 implements MigrationInterface {
  name = "AddDealsUncleanedDatasetIndex1779200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_deals_unclean_dataset"
       ON deals (data_set_id)
       WHERE cleaned_up = false AND data_set_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_deals_unclean_dataset"`);
  }
}
