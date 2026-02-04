# Jobs Runbook (pg-boss)

This runbook covers operational tasks for the pg-boss scheduler.

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

## Notes

- Offsets (`*_START_OFFSET_SECONDS`) are ignored in pg-boss mode.
- Job schedules are rate-based (per hour) and persist across restarts.
- Paused schedules remain paused until explicitly resumed.

## Staggering multiple dealbot deployments

Some SPs deploy testnet and mainnet in the same computer room. If you are running more than
one dealbot in the same environment, use a phase offset and jitter to spread load and avoid
uplink/downlink backlogs happening at the same time:

- `JOB_SCHEDULE_PHASE_SECONDS` shifts the initial `next_run_at` for all schedules.
- `JOB_ENQUEUE_JITTER_SECONDS` adds random delay when jobs are enqueued.

Example with two deployments running the same rates:

Deployment A:

```
JOB_SCHEDULE_PHASE_SECONDS=0
JOB_ENQUEUE_JITTER_SECONDS=300
```

Deployment B:

```
JOB_SCHEDULE_PHASE_SECONDS=1200
JOB_ENQUEUE_JITTER_SECONDS=300
```

This staggers schedules by 20 minutes and randomizes starts within 5 minutes.
