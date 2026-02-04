import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddJobScheduleState1760000000000 implements MigrationInterface {
  name = "AddJobScheduleState1760000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto
    `);

    await queryRunner.query(`
      CREATE SCHEMA IF NOT EXISTS pgboss
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS job_schedule_state (
        id BIGSERIAL PRIMARY KEY,
        job_type TEXT NOT NULL,
        sp_address TEXT NOT NULL DEFAULT '',
        interval_seconds INTEGER NOT NULL,
        next_run_at TIMESTAMPTZ NOT NULL,
        last_run_at TIMESTAMPTZ DEFAULT NULL,
        paused BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT job_schedule_state_job_type_sp_unique UNIQUE (job_type, sp_address)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_job_schedule_state_next_run
      ON job_schedule_state (next_run_at)
      WHERE paused = false
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_job_schedule_state_job_type
      ON job_schedule_state (job_type)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_job_schedule_state_job_type
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_job_schedule_state_next_run
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS job_schedule_state
    `);

    // NOTE: We intentionally keep the pgboss schema and pgcrypto extension on rollback
    // to avoid disrupting other consumers or losing job history.
  }
}
