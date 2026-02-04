import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import type { JobScheduleType } from "../../database/entities/job-schedule-state.entity.js";

export type ScheduleRow = {
  id: number;
  job_type: JobScheduleType;
  sp_address: string;
  interval_seconds: number;
  next_run_at: string;
};

@Injectable()
export class JobScheduleRepository {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Inserts or updates a schedule row for a specific job type and provider.
   * If the row exists, it updates the interval and ensures the job is not paused.
   *
   * @param jobType - The type of job (deal, retrieval, metrics, etc.)
   * @param spAddress - The storage provider address (or empty string for global jobs)
   * @param intervalSeconds - The frequency of the job in seconds
   * @param nextRunAt - The scheduled time for the next run
   */
  async upsertSchedule(
    jobType: JobScheduleType,
    spAddress: string,
    intervalSeconds: number,
    nextRunAt: Date,
  ): Promise<void> {
    await this.dataSource.query(
      `
      INSERT INTO job_schedule_state (job_type, sp_address, interval_seconds, next_run_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (job_type, sp_address) DO UPDATE
      SET interval_seconds = EXCLUDED.interval_seconds,
          paused = job_schedule_state.paused,
          updated_at = NOW()
      `,
      [jobType, spAddress, intervalSeconds, nextRunAt],
    );
  }

  /**
   * Pauses schedule rows for providers that are no longer in the active list.
   * This is used to "soft delete" schedules when a provider is removed from configuration or goes inactive.
   *
   * @param activeAddresses - List of currently active provider addresses to keep enabled.
   */
  async pauseMissingProviders(activeAddresses: string[]): Promise<void> {
    if (activeAddresses.length === 0) {
      await this.dataSource.query(
        `
        UPDATE job_schedule_state
        SET paused = true,
            updated_at = NOW()
        WHERE job_type IN ('deal', 'retrieval')
          AND sp_address <> ''
        `,
      );
    } else {
      await this.dataSource.query(
        `
        UPDATE job_schedule_state
        SET paused = true,
            updated_at = NOW()
        WHERE job_type IN ('deal', 'retrieval')
          AND sp_address <> ''
          AND sp_address <> ALL($1::text[])
        `,
        [activeAddresses],
      );
    }
  }

  /**
   * Finds schedule rows that are due for execution (next_run_at <= now).
   * Uses `FOR UPDATE SKIP LOCKED` to allow safe concurrent execution if multiple schedulers were running.
   *
   * @param manager - The transaction manager to execute the query within.
   * @param now - The reference time to check for due jobs.
   */
  async findDueSchedulesWithManager(
    manager: { query: (sql: string, params?: any[]) => Promise<any> },
    now: Date,
  ): Promise<ScheduleRow[]> {
    return manager.query(
      `
      SELECT id, job_type, sp_address, interval_seconds, next_run_at
      FROM job_schedule_state
      WHERE paused = false
        AND next_run_at <= $1
      ORDER BY next_run_at ASC
      FOR UPDATE SKIP LOCKED
      `,
      [now],
    );
  }

  /**
   * Updates a schedule row after a job has been enqueued.
   * Sets the new execution time and updates the last run timestamp.
   *
   * @param manager - The transaction manager.
   * @param id - The ID of the schedule row.
   * @param nextRunAt - The new scheduled time.
   * @param lastRunAt - The time the job was just run (usually 'now').
   */
  async updateScheduleAfterRun(
    manager: { query: (sql: string, params?: any[]) => Promise<any> },
    id: number,
    nextRunAt: Date,
    lastRunAt: Date,
  ): Promise<void> {
    await manager.query(
      `
      UPDATE job_schedule_state
      SET next_run_at = $1,
          last_run_at = $2,
          updated_at = NOW()
      WHERE id = $3
      `,
      [nextRunAt, lastRunAt, id],
    );
  }

  /**
   * Executes a callback within a database transaction.
   */
  async runTransaction<T>(runInTransaction: (entityManager: any) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(runInTransaction);
  }

  /**
   * Counts pg-boss jobs by name and state for the requested states.
   */
  async countBossJobStates(states: string[]): Promise<{ name: string; state: string; count: number }[]> {
    return this.dataSource.query(
      `
      SELECT name, state, COUNT(*)::int AS count
      FROM pgboss.job
      WHERE state = ANY($1::text[])
      GROUP BY name, state
      `,
      [states],
    );
  }

  /**
   * Returns the minimum age (seconds) for jobs in a given pg-boss state, grouped by name.
   * Uses created_on for queued jobs and started_on for active jobs.
   */
  async minBossJobAgeSecondsByState(
    state: "created" | "active",
    now: Date,
  ): Promise<{ name: string; min_age_seconds: number | null }[]> {
    const timestampColumn = state === "created" ? "created_on" : "started_on";
    return this.dataSource.query(
      `
      SELECT name, MIN(EXTRACT(EPOCH FROM ($1 - ${timestampColumn}))) AS min_age_seconds
      FROM pgboss.job
      WHERE state = $2
      GROUP BY name
      `,
      [now, state],
    );
  }

  /**
   * Tries to acquire a Postgres advisory lock for a specific provider.
   * This ensures only one worker processes a specific provider at a time if multiple workers pick up jobs.
   *
   * @param spAddress - The provider address to lock.
   * @returns true if the lock was acquired, false otherwise.
   */
  async acquireAdvisoryLock(spAddress: string): Promise<boolean> {
    const result = await this.dataSource.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired", [
      spAddress,
    ]);
    return Boolean(result?.[0]?.acquired);
  }

  /**
   * Releases the Postgres advisory lock for a specific provider.
   *
   * @param spAddress - The provider address to unlock.
   */
  async releaseAdvisoryLock(spAddress: string): Promise<void> {
    await this.dataSource.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [spAddress]);
  }
}
