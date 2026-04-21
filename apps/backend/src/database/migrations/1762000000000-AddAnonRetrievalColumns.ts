import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddAnonRetrievalColumns1762000000000 implements MigrationInterface {
  name = "AddAnonRetrievalColumns1762000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Make deal_id nullable — anonymous retrievals have no dealbot deal.
    await queryRunner.query(`
      ALTER TABLE retrievals
      ALTER COLUMN deal_id DROP NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE retrievals
      ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT FALSE
    `);

    await queryRunner.query(`
      ALTER TABLE retrievals
      ADD COLUMN IF NOT EXISTS anon_piece_cid TEXT DEFAULT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE retrievals
      ADD COLUMN IF NOT EXISTS anon_data_set_id TEXT DEFAULT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE retrievals
      ADD COLUMN IF NOT EXISTS anon_piece_id TEXT DEFAULT NULL
    `);

    // NULL = not checked (e.g., retrieval failed before CommP step)
    await queryRunner.query(`
      ALTER TABLE retrievals
      ADD COLUMN IF NOT EXISTS commp_valid BOOLEAN DEFAULT NULL
    `);

    // NULL = not checked (e.g., withIPFSIndexing was false or piece retrieval failed)
    await queryRunner.query(`
      ALTER TABLE retrievals
      ADD COLUMN IF NOT EXISTS car_valid BOOLEAN DEFAULT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_retrievals_is_anonymous"
      ON retrievals (is_anonymous)
      WHERE is_anonymous = TRUE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_retrievals_is_anonymous"`);
    await queryRunner.query(`ALTER TABLE retrievals DROP COLUMN IF EXISTS car_valid`);
    await queryRunner.query(`ALTER TABLE retrievals DROP COLUMN IF EXISTS commp_valid`);
    await queryRunner.query(`ALTER TABLE retrievals DROP COLUMN IF EXISTS anon_piece_id`);
    await queryRunner.query(`ALTER TABLE retrievals DROP COLUMN IF EXISTS anon_data_set_id`);
    await queryRunner.query(`ALTER TABLE retrievals DROP COLUMN IF EXISTS anon_piece_cid`);
    await queryRunner.query(`ALTER TABLE retrievals DROP COLUMN IF EXISTS is_anonymous`);

    // Restore NOT NULL on deal_id (only safe if all anonymous rows are cleaned up first)
    await queryRunner.query(`
      ALTER TABLE retrievals
      ALTER COLUMN deal_id SET NOT NULL
    `);
  }
}
