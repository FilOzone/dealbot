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

- Offsets (`*_START_OFFSET_SECONDS`) are ignored in pg-boss mode.
- Job schedules are rate-based (per hour) and persist across restarts.
- Paused schedules remain paused until explicitly resumed. Pausing is strictly for manual/admin use.
- Schedules for providers that are removed from configuration or go inactive are **automatically deleted** to keep the job list clean. Manually paused jobs for active providers are preserved.

## Manual pg-boss migration

If the database still has the legacy pg-boss schema (no `queue` table), the application
startup migration (apps/backend/src/database/migrations/1760550000000-EnsurePgBossSchema.ts) will fail with:

```
pg-boss migration failed: <reason>. See docs/runbooks/jobs.md for manual migration steps.
```

Use the steps below to prepare a new schema (`pgboss_new`) and validate it before deploying.
Once `pgboss_new` exists, the app migration will copy it into a fresh `pgboss` schema on deploy.

### 1) Create the new schema with pg-boss (v12)

```
npx pg-boss@12.11.1 create --schema pgboss_new --connection-string "$DATABASE_URL"
```

### 2) (Optional) Copy legacy jobs/schedules into the new schema

This preserves existing job history.

```sql
-- Ensure queues exist for job names and schedules
INSERT INTO pgboss_new.queue (
  name, policy, retry_limit, retry_delay, retry_backoff, retry_delay_max,
  expire_seconds, retention_seconds, deletion_seconds, dead_letter, partition, table_name,
  deferred_count, queued_count, warning_queued, active_count, total_count,
  singletons_active, monitor_on, maintain_on, created_on, updated_on
)
SELECT
  q.name,
  'standard', 2, 0, false, NULL,
  900, 1209600, 604800, NULL, false, 'job_common',
  0, 0, 0, 0, 0,
  NULL, NULL, NULL, now(), now()
FROM (
  SELECT DISTINCT name FROM pgboss.job
  UNION
  SELECT DISTINCT name FROM pgboss.schedule
) q
LEFT JOIN pgboss_new.queue existing ON existing.name = q.name
WHERE existing.name IS NULL;

-- Copy schedules (v6 has no `key`, so use empty string)
INSERT INTO pgboss_new.schedule (
  name, key, cron, timezone, data, options, created_on, updated_on
)
SELECT
  name, '' AS key, cron, timezone, data, options, created_on, updated_on
FROM pgboss.schedule
ON CONFLICT (name, key) DO NOTHING;

-- Copy jobs (maps legacy `expired` -> `cancelled`)
INSERT INTO pgboss_new.job (
  id, name, priority, data, state,
  retry_limit, retry_count, retry_delay, retry_backoff, retry_delay_max,
  expire_seconds, deletion_seconds,
  singleton_key, singleton_on, group_id, group_tier,
  start_after, created_on, started_on, completed_on, keep_until,
  output, dead_letter, policy
)
SELECT
  id,
  name,
  priority,
  data,
  (CASE WHEN state::text = 'expired' THEN 'cancelled' ELSE state::text END)::pgboss_new.job_state,
  retrylimit,
  retrycount,
  retrydelay,
  retrybackoff,
  NULL::int,
  COALESCE(EXTRACT(EPOCH FROM expirein)::int, 900),
  604800,
  singletonkey,
  singletonon,
  NULL::text,
  NULL::text,
  startafter,
  createdon,
  startedon,
  completedon,
  keepuntil,
  output,
  NULL::text,
  'standard'
FROM pgboss.job;
```

### 3) Ensure required queues exist in the new schema

```sql
SELECT pgboss_new.create_queue('deal.run', '{"policy":"standard"}'::jsonb);
SELECT pgboss_new.create_queue('retrieval.run', '{"policy":"standard"}'::jsonb);
SELECT pgboss_new.create_queue('metrics.run', '{"policy":"standard"}'::jsonb);
SELECT pgboss_new.create_queue('metrics.cleanup', '{"policy":"standard"}'::jsonb);
```

### 4) Deploy

On deploy, the migration will:
- Rename the existing `pgboss` schema to `pgboss_v6` (backup) if it is legacy.
- Create a fresh `pgboss` schema (v12) and copy data from `pgboss_new` (if present) or from `pgboss_v6`.
- Leave `pgboss_new` intact for verification (you can drop it later).

Stop the app before running the manual steps to avoid concurrent writes.

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
