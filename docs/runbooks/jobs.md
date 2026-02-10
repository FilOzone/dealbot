# Jobs Runbook (pg-boss)

This runbook covers operational tasks for the pg-boss scheduler.
For system behavior and job definitions, see `docs/jobs.md`.

## Pausing jobs

pg-boss schedules are stored in the `job_schedule_state` table.
To pause job execution for maintenance windows, set `paused = true`.
For routine daily maintenance windows, prefer `DEALBOT_MAINTENANCE_WINDOWS_UTC` and
`DEALBOT_MAINTENANCE_WINDOW_MINUTES`, which skip deal/retrieval checks automatically in both cron and pg-boss modes.

```sql
-- Pause all deal and retrieval jobs
UPDATE job_schedule_state
SET paused = true, updated_at = NOW()
WHERE job_type IN ('deal', 'retrieval');

-- Pause metrics jobs
UPDATE job_schedule_state
SET paused = true, updated_at = NOW()
WHERE job_type IN ('metrics', 'metrics_cleanup');
```

To pause a single provider:

```sql
UPDATE job_schedule_state
SET paused = true, updated_at = NOW()
WHERE job_type IN ('deal', 'retrieval')
  AND sp_address = '<sp-address>';
```

## Resuming jobs

```sql
UPDATE job_schedule_state
SET paused = false, next_run_at = NOW(), updated_at = NOW()
WHERE job_type IN ('deal', 'retrieval', 'metrics', 'metrics_cleanup');
```

To resume a single provider:

```sql
UPDATE job_schedule_state
SET paused = false, next_run_at = NOW(), updated_at = NOW()
WHERE job_type IN ('deal', 'retrieval')
  AND sp_address = '<sp-address>';
```

## Trigger jobs on demand

You can force schedules to be due immediately by setting `next_run_at = NOW()`.
The scheduler will enqueue jobs on the next poll.

Kick off a metrics run now:

```sql
UPDATE job_schedule_state
SET paused = false, next_run_at = NOW(), updated_at = NOW()
WHERE job_type = 'metrics';
```

Run all deal schedules now:

```sql
UPDATE job_schedule_state
SET paused = false, next_run_at = NOW(), updated_at = NOW()
WHERE job_type = 'deal';
```

Run all retrieval schedules now:

```sql
UPDATE job_schedule_state
SET paused = false, next_run_at = NOW(), updated_at = NOW()
WHERE job_type = 'retrieval';
```

Run a deal or retrieval for a specific SP:

```sql
UPDATE job_schedule_state
SET paused = false, next_run_at = NOW(), updated_at = NOW()
WHERE job_type = 'deal'
  AND sp_address = '<sp-address>';

UPDATE job_schedule_state
SET paused = false, next_run_at = NOW(), updated_at = NOW()
WHERE job_type = 'retrieval'
  AND sp_address = '<sp-address>';
```

## References

- System overview: `docs/jobs.md`
- Environment variables: `docs/environment-variables.md`
