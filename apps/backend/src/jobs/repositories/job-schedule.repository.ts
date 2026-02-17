import { Injectable, Logger } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import type { JobScheduleType } from "../../database/entities/job-schedule-state.entity.js";
import {
  DATA_RETENTION_POLL_QUEUE,
  LEGACY_DEAL_QUEUE,
  LEGACY_RETRIEVAL_QUEUE,
  METRICS_CLEANUP_QUEUE,
  METRICS_QUEUE,
  SP_WORK_QUEUE,
} from "../job-queues.js";

export type ScheduleRow = {
  id: number;
  job_type: JobScheduleType;
  sp_address: string;
  interval_seconds: number;
  next_run_at: string;
};

@Injectable()
export class JobScheduleRepository {
  private readonly logger = new Logger(JobScheduleRepository.name);

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
   * Deletes schedule rows for providers that are no longer in the active list.
   *
   * Note: if activeAddresses is empty, this method deletes all provider schedules
   * (excluding global schedules with empty sp_address). Callers should guard against
   * empty inputs unless that behavior is intended.
   *
   * @param activeAddresses - List of currently active provider addresses to keep.
   * @returns Array of storage provider addresses whose schedules were deleted.
   */
  async deleteSchedulesForInactiveProviders(activeAddresses: string[]): Promise<string[]> {
    try {
      if (activeAddresses.length === 0) {
        this.logger.warn(
          "Deleting all provider schedules because activeAddresses is empty. Ensure this is intended to avoid mass deletion.",
        );
        const result =
          (await this.dataSource.query(
            `
          DELETE FROM job_schedule_state
          WHERE job_type IN ('deal', 'retrieval')
            AND sp_address <> ''
          RETURNING sp_address
          `,
          )) || [];
        return result.map((row: { sp_address: string }) => row.sp_address);
      }

      const result =
        (await this.dataSource.query(
          `
        DELETE FROM job_schedule_state
        WHERE job_type IN ('deal', 'retrieval')
          AND sp_address <> ''
          AND sp_address <> ALL($1::text[])
        RETURNING sp_address
        `,
          [activeAddresses],
        )) || [];
      return result.map((row: { sp_address: string }) => row.sp_address);
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`Failed to delete schedules for inactive providers: ${error.message}`, error.stack);
      } else {
        this.logger.error("Failed to delete schedules for inactive providers", String(error));
      }
      throw error;
    }
  }

  /**
   * Counts manually paused jobs by type.
   */
  async countPausedSchedules(): Promise<{ job_type: string; count: number }[]> {
    return this.dataSource.query(
      `
      SELECT job_type, COUNT(*)::int AS count
      FROM job_schedule_state
      WHERE paused = true
      GROUP BY job_type
      `,
    );
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
   * Counts pg-boss jobs by dealbot job type and state for the requested states.
   * Uses `data->>'jobType'` for the shared sp.work queue and maps legacy queue names.
   * Casts state to text so drivers always return a string (pg-boss uses job_state enum).
   */
  async countBossJobStates(states: string[]): Promise<{ job_type: string; state: string; count: number }[]> {
    return this.dataSource.query(
      `
      SELECT
        CASE
          WHEN name = $2 THEN COALESCE(data->>'jobType', 'unknown')
          WHEN name = $3 THEN 'metrics'
          WHEN name = $4 THEN 'metrics_cleanup'
          WHEN name = $5 THEN 'deal'
          WHEN name = $6 THEN 'retrieval'
          WHEN name = $7 THEN 'data_retention_poll'
          ELSE name
        END AS job_type,
        state::text AS state,
        COUNT(*)::int AS count
      FROM pgboss.job
      WHERE state::text = ANY($1::text[])
      GROUP BY 1, 2
      `,
      [
        states,
        SP_WORK_QUEUE,
        METRICS_QUEUE,
        METRICS_CLEANUP_QUEUE,
        LEGACY_DEAL_QUEUE,
        LEGACY_RETRIEVAL_QUEUE,
        DATA_RETENTION_POLL_QUEUE,
      ],
    );
  }

  /**
   * Returns the minimum age (seconds) for jobs in a given pg-boss state, grouped by job type.
   * Uses created_on for queued jobs and started_on for active jobs (pg-boss schema column names).
   */
  async minBossJobAgeSecondsByState(
    state: "created" | "active",
    now: Date,
  ): Promise<{ job_type: string; min_age_seconds: number | null }[]> {
    return this.dataSource.query(
      `
      SELECT
        CASE
          WHEN name = $3 THEN COALESCE(data->>'jobType', 'unknown')
          WHEN name = $4 THEN 'metrics'
          WHEN name = $5 THEN 'metrics_cleanup'
          WHEN name = $6 THEN 'deal'
          WHEN name = $7 THEN 'retrieval'
          WHEN name = $8 THEN 'data_retention_poll'
          ELSE name
        END AS job_type,
        MIN(
          EXTRACT(
            EPOCH FROM (
              $1 - CASE
                    WHEN $2::text = 'created' THEN created_on
                    ELSE started_on
                  END
            )
          )
        ) AS min_age_seconds
      FROM pgboss.job
      WHERE state::text = $2
      GROUP BY 1
      `,
      [
        now,
        state,
        SP_WORK_QUEUE,
        METRICS_QUEUE,
        METRICS_CLEANUP_QUEUE,
        LEGACY_DEAL_QUEUE,
        LEGACY_RETRIEVAL_QUEUE,
        DATA_RETENTION_POLL_QUEUE,
      ],
    );
  }
}
