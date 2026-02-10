import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddJobMutex1760000000003 implements MigrationInterface {
  name = "AddJobMutex1760000000003";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS job_mutex (
        job_type TEXT NOT NULL,
        sp_address TEXT NOT NULL,
        job_id UUID NOT NULL,
        hostname TEXT NOT NULL,
        acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT job_mutex_sp_unique UNIQUE (sp_address)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_job_mutex_job_type
      ON job_mutex (job_type)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_job_mutex_hostname
      ON job_mutex (hostname)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_job_mutex_hostname
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_job_mutex_job_type
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS job_mutex
    `);
  }
}
