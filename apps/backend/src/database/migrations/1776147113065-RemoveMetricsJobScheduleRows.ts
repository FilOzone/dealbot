import type { MigrationInterface, QueryRunner } from "typeorm";

export class RemoveMetricsJobScheduleRows1776147113065 implements MigrationInterface {
  name = "RemoveMetricsJobScheduleRows1776147113065";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Remove legacy job schedule rows for metrics job types that are no longer handled.
    // Without this, the scheduler loop fetches these rows on every tick (they never advance
    // next_run_at) and emits a warning log until they are manually removed.
    await queryRunner.query(`DELETE FROM job_schedule_state WHERE job_type IN ('metrics', 'metrics_cleanup')`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Irreversible: the deleted legacy metrics job types are no longer scheduled or handled,
    // so there is no safe way to reconstruct the removed job_schedule_state rows.
  }
}
