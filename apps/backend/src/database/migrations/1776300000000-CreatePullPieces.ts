import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePullPieces1776300000000 implements MigrationInterface {
  name = "CreatePullPieces1776300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS pull_pieces (
        piece_cid TEXT PRIMARY KEY,
        provider_address TEXT NOT NULL,
        key TEXT NOT NULL,
        size INT NOT NULL,
        pull_submitted_at TIMESTAMPTZ,
        first_byte_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS pull_pieces`);
  }
}
