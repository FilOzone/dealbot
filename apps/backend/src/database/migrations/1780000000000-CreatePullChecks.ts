import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePullChecks1780000000000 implements MigrationInterface {
  name = "CreatePullChecks1780000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pull_checks_status_enum') THEN
          CREATE TYPE "pull_checks_status_enum" AS ENUM (
            'pending',
            'requesting',
            'polling',
            'verifying',
            'success',
            'failed',
            'timed_out'
          );
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pull_checks_verification_status_enum') THEN
          CREATE TYPE "pull_checks_verification_status_enum" AS ENUM (
            'pending',
            'passed',
            'failed',
            'skipped'
          );
        END IF;
      END$$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS pull_checks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sp_address VARCHAR NOT NULL,
        piece_cid VARCHAR NOT NULL,
        source_url TEXT NOT NULL,
        request_id VARCHAR NULL,
        status pull_checks_status_enum NOT NULL DEFAULT 'pending',
        provider_status VARCHAR NULL,
        failure_reason TEXT NULL,
        request_started_at TIMESTAMPTZ NULL,
        request_completed_at TIMESTAMPTZ NULL,
        completed_at TIMESTAMPTZ NULL,
        verification_status pull_checks_verification_status_enum NULL,
        verification_completed_at TIMESTAMPTZ NULL,
        verification_message TEXT NULL,
        hosted_piece_expires_at TIMESTAMPTZ NOT NULL,
        hosted_piece_cleaned_up_at TIMESTAMPTZ NULL,
        error_code VARCHAR NULL,
        error_message TEXT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pull_checks_sp_address ON pull_checks (sp_address)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pull_checks_status ON pull_checks (status)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pull_checks_created_at ON pull_checks (created_at)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_pull_checks_created_at`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_pull_checks_status`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_pull_checks_sp_address`);
    await queryRunner.query(`DROP TABLE IF EXISTS pull_checks`);
    await queryRunner.query(`DROP TYPE IF EXISTS pull_checks_verification_status_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS pull_checks_status_enum`);
  }
}
