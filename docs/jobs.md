# Jobs (pg-boss)

This doc explains what a job is in dealbot when `DEALBOT_JOBS_MODE=pgboss`. For operational steps (pausing/resuming/triggering jobs), see the runbook in [`docs/runbooks/jobs.md`](./runbooks/jobs.md).

## Summary

- Jobs are scheduled via `job_schedule_state` rows and executed via pg-boss queues.
- There is one schedule row per `<job_type, sp_address>` plus global jobs that use an empty `sp_address`.
- A scheduler loop polls for due schedules, enqueues pg-boss jobs, and advances `next_run_at`.
- Deal/retrieval jobs share the `sp.work` queue with `policy=singleton` and `singletonKey=spAddress` to ensure only one active job per SP while allowing backlog.
- Workers poll pg-boss queues via [`boss.work()`](https://github.com/timgit/pg-boss/blob/master/docs/api/workers.md) and execute the actual deal/retrieval/metrics handlers.

## Cardinality and Tables

- **Schedule rows**: `job_schedule_state` has a unique constraint on `(job_type, sp_address)`, which means one row per job type per SP address. Global jobs use `sp_address = ''`. Source: [`job-schedule-state.entity.ts`](../apps/backend/src/database/entities/job-schedule-state.entity.ts), [`1760000000000-AddJobScheduleState.ts`](../apps/backend/src/database/migrations/1760000000000-AddJobScheduleState.ts).
- **Queue rows**: pg-boss stores jobs in the `pgboss.job` table (created by pg-boss under the `pgboss` schema). We read from this table for metrics. Source: [`job-schedule.repository.ts`](../apps/backend/src/jobs/repositories/job-schedule.repository.ts) (queries `pgboss.job`).

## Job Types and Queues

Job types map to pg-boss queue names in [`JobsService.mapJobName`](../apps/backend/src/jobs/jobs.service.ts):

- `deal` -> `sp.work` (with `jobType=deal`)
- `retrieval` -> `sp.work` (with `jobType=retrieval`)
- `metrics` -> `metrics.run`
- `metrics_cleanup` -> `metrics.cleanup`

Jobs are enqueued via [`boss.send(name, data, options)`](https://github.com/timgit/pg-boss/blob/master/docs/api/jobs.md), which inserts rows into `pgboss.job`. Workers consume them via [`boss.work(name, options, handler)`](https://github.com/timgit/pg-boss/blob/master/docs/api/workers.md).

> **Note:** `sp.work` is created with `policy=singleton` and jobs set `singletonKey=spAddress` so only one active job per SP can run at a time.

> **Note:** pg-boss also has a separate [pub/sub API](https://github.com/timgit/pg-boss/blob/master/docs/api/pubsub.md) (`publish`/`subscribe`) for fan-out to multiple queues. We do **not** use pub/sub — we use `send`/`work` for direct queue processing.

Source: [`jobs.service.ts`](../apps/backend/src/jobs/jobs.service.ts).

## Pg-boss vs Dealbot Scheduling

- pg-boss provides durable queues and worker execution. Dealbot owns schedule state and timing via `job_schedule_state`.
- We do not call `boss.schedule(...)` or use pg-boss cron scheduling. The scheduler tick decides when a job is due and enqueues it.
- This custom scheduler exists because we need per-SP rate schedules, catch-up behavior with caps/jitter, maintenance-window deferral, and per-SP singleton execution (deal + retrieval share a queue).

## Pg-boss Storage, Retention, and Cleanup

- Queue rows are stored in `pgboss.job`. pg-boss manages job lifecycle within this table (there is no separate archive table in pg-boss v9+).
- pg-boss has built-in supervision that handles expired jobs and maintenance. These behaviors are controlled by [constructor options](https://github.com/timgit/pg-boss/blob/master/docs/api/constructor.md) such as `superviseIntervalSeconds`, `maintenanceIntervalSeconds`, and `monitorIntervalSeconds`.
- Dealbot currently uses pg-boss defaults for these options (we do not override them in code).

Reference: [pg-boss constructor docs](https://github.com/timgit/pg-boss/blob/master/docs/api/constructor.md)

## How Schedules Are Created and Updated

1. **Startup provider sync**: When pg-boss is enabled, `JobsService` calls `WalletSdkService.ensureWalletAllowances()` and `WalletSdkService.loadProviders()` (unless `DEALBOT_DISABLE_CHAIN=true`). `loadProviders()` pulls providers from the on-chain SP registry and syncs them into the `storage_providers` table (fields include `is_active` and `is_approved`). Source: [`jobs.service.ts`](../apps/backend/src/jobs/jobs.service.ts), [`wallet-sdk.service.ts`](../apps/backend/src/wallet-sdk/wallet-sdk.service.ts).

2. **Scheduler tick creates/updates schedules**: The scheduler loop runs immediately on startup and then every `JOB_SCHEDULER_POLL_SECONDS`. It queries `storage_providers` and upserts schedules for each active provider (and only approved providers if `USE_ONLY_APPROVED_PROVIDERS=true`). It also ensures global metrics schedules exist (`sp_address = ''`). It deletes deal/retrieval schedules for providers that are no longer active/approved. Source: [`jobs.service.ts`](../apps/backend/src/jobs/jobs.service.ts), [`job-schedule.repository.ts`](../apps/backend/src/jobs/repositories/job-schedule.repository.ts).

3. **New SP added to registry (example)**: A new provider becomes visible once `WalletSdkService.loadProviders()` runs and syncs the `storage_providers` table. On the next scheduler tick, `ensureScheduleRows()` upserts `deal` and `retrieval` schedules for that SP. If `USE_ONLY_APPROVED_PROVIDERS=true`, the provider must be both `is_active=true` and `is_approved=true` to be scheduled.

4. **SP status changes (example)**: When `loadProviders()` syncs updated provider status into `storage_providers`, the next scheduler tick re-evaluates active/approved providers. If a provider is no longer active or approved, its deal/retrieval schedules are deleted.

Note: In pg-boss mode, provider sync currently happens at startup (and whenever `loadProviders()` is called). There is no periodic refresh loop, so new/changed providers require a refresh (restart or an explicit call to `loadProviders()`).

## How `next_run_at` Changes

`next_run_at` is controlled entirely by the scheduler loop:

- **Initial value**: set by `upsertSchedule()` when schedules are created, using `now + JOB_SCHEDULE_PHASE_SECONDS`.
- **On each tick**: The scheduler finds rows where `next_run_at <= now`, computes how many runs are due based on `interval_seconds`, enqueues up to `JOB_CATCHUP_MAX_ENQUEUE` runs per schedule row, and on successful enqueue advances `next_run_at` by `successCount * interval_seconds` while updating `last_run_at`.
- **Maintenance windows**: Deal/retrieval jobs are still enqueued, but workers defer execution until the window ends; `next_run_at` advances based on successful enqueues.

Source: [`jobs.service.ts`](../apps/backend/src/jobs/jobs.service.ts), [`job-schedule.repository.ts`](../apps/backend/src/jobs/repositories/job-schedule.repository.ts).

## Polling Behavior

- **Scheduler polling**: `JobsService` runs a scheduler tick every `JOB_SCHEDULER_POLL_SECONDS` (default 300s).
- **Worker polling**: pg-boss workers check for new jobs every `JOB_WORKER_POLL_SECONDS` (default 60s) via the [`pollingIntervalSeconds`](https://github.com/timgit/pg-boss/blob/master/docs/api/workers.md) worker option.

Source: [`jobs.service.ts`](../apps/backend/src/jobs/jobs.service.ts), [`app.config.ts`](../apps/backend/src/config/app.config.ts).

## Run Modes

`DEALBOT_RUN_MODE` controls which components run in a process:

- `api`: API server + scheduler + `/metrics` (no workers)
- `worker`: workers + `/metrics` only (no API)
- `both`: API server + scheduler + workers + `/metrics`

Notes:

- In pg-boss mode, `DEALBOT_RUN_MODE=api` disables workers.
- Set `DEALBOT_PGBOSS_SCHEDULER_ENABLED=false` to disable the enqueue loop (worker-only pods).
- `/metrics` is served on `DEALBOT_PORT` for `api`/`both` and on `DEALBOT_METRICS_PORT` for `worker`.

## Architecture (api + worker)

```mermaid
flowchart LR
  subgraph API["mode=api"]
    APIHTTP["API server"]
    Scheduler["Scheduler tick"]
    APIMetrics["/metrics endpoint"]
  end

  subgraph Worker["mode=worker"]
    Workers["pg-boss workers"]
    Metrics["/metrics server"]
  end

  DB["Postgres"]
  ScheduleTable["job_schedule_state"]
  BossJobs["pgboss.job"]
  SpQueue["sp.work (singleton)"]

  APIHTTP --> DB
  APIMetrics --> DB
  Scheduler --> ScheduleTable
  Scheduler --> BossJobs
  Scheduler --> SpQueue
  ScheduleTable --> DB
  BossJobs --> DB

  Workers --> BossJobs
  Workers --> SpQueue
  Workers --> DB
```

## Parallelism and Limits

- **Queue concurrency**: Deal/retrieval share the `sp.work` queue. Per-instance worker concurrency is `DEAL_MAX_CONCURRENCY + RETRIEVAL_MAX_CONCURRENCY` (pg-boss `localConcurrency`), with `batchSize=1`. Metrics/cleanup remain fixed at `batchSize=1`. Total concurrency scales with the number of worker pods.
- **Per-SP exclusion**: `sp.work` is created with `policy=singleton`, and jobs are enqueued with `singletonKey=spAddress`, ensuring only one active job per SP across all workers while allowing backlog.

Source: [`jobs.service.ts`](../apps/backend/src/jobs/jobs.service.ts), [`job-schedule.repository.ts`](../apps/backend/src/jobs/repositories/job-schedule.repository.ts).

## Backpressure and Catch-Up

- **Catch-up cap**: `JOB_CATCHUP_MAX_ENQUEUE` limits how many runs are enqueued per schedule row per tick.
- **Staggering**: `JOB_CATCHUP_SPREAD_HOURS` spreads catch-up jobs, and `JOB_ENQUEUE_JITTER_SECONDS` adds random delay.
Example: If a job is scheduled every 15 minutes but takes 20 minutes, jobs will queue in pg-boss. The per-SP singleton prevents overlap, so runs execute sequentially and a backlog grows. Catch-up limits cap how fast backlog is enqueued per tick.

## Capacity and Limits

Use these formulas to reason about whether the system can keep up and how much backlog it can absorb.

Per-SP capacity (one job per SP at a time):

- Per-SP load (minutes/hour) = `(deals_per_sp_per_hour * deal_max_minutes) + (retrievals_per_sp_per_hour * retrieval_max_minutes)`
- If per-SP load > 60, that SP can never catch up (backlog grows).
- If per-SP load <= 60, backlog will eventually drain (catch-up rate = `60 - per_sp_load` minutes/hour).

Cluster capacity (worker pool bound):

- Deal capacity (deals/hour) = `workers * DEAL_MAX_CONCURRENCY * (60 / deal_max_minutes)`
- Retrieval capacity (retrievals/hour) = `workers * RETRIEVAL_MAX_CONCURRENCY * (60 / retrieval_max_minutes)`
- Max sustainable SP count = `min(deal_capacity / deals_per_sp_per_hour, retrieval_capacity / retrievals_per_sp_per_hour)`

Note: Deal and retrieval jobs share the same `sp.work` queue, so the effective concurrency is the combined budget (`DEAL_MAX_CONCURRENCY + RETRIEVAL_MAX_CONCURRENCY`) and will skew toward whichever job type dominates the backlog.

Example (18 SPs, 4 deals/hr @ 5m, 6 retrievals/hr @ 2m, 5 workers, 10/10 concurrency):

- Per-SP load = `4*5m + 6*2m = 32 min/hr` (OK; 28 min/hr headroom)
- Deal capacity = `5 workers * 10 deals/hr/worker * (60/5m) = 600 deals/hr` => `600/4 = 150 SPs`
- Retrieval capacity = `5 workers * 10 retrievals/hr/worker * (60/2m) = 1500 retrievals/hr` => `1500/6 = 250 SPs`
- Binding limit = deals => ~150 SPs max before capacity <= arrival

## Staggering Multiple Deployments

If you run more than one dealbot in the same environment, use a phase offset and jitter to spread load:

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

## Is There a "Job Run" Record?

- Dealbot does **not** store a first-class "job run" entity.
- `job_schedule_state.last_run_at` is updated when schedules are advanced (enqueue time), not when handlers finish.
- pg-boss itself stores each queued job in `pgboss.job` with states like `created`, `active`, and `retry` (we query this table for queue metrics).
- Execution metrics are exported via Prometheus (`jobs_started_total`, `jobs_completed_total`, `job_duration_seconds`).

Source: [`jobs.service.ts`](../apps/backend/src/jobs/jobs.service.ts), [`job-schedule.repository.ts`](../apps/backend/src/jobs/repositories/job-schedule.repository.ts), [`metrics-prometheus.module.ts`](../apps/backend/src/metrics-prometheus/metrics-prometheus.module.ts).

## Critical Environment Variables

See the "Jobs (pg-boss)" section in [`docs/environment-variables.md`](./environment-variables.md) for full definitions. The most important knobs are:

- `DEALBOT_JOBS_MODE`
- `DEALBOT_PGBOSS_SCHEDULER_ENABLED`
- `DEALBOT_RUN_MODE`
- `DEALS_PER_SP_PER_HOUR`, `RETRIEVALS_PER_SP_PER_HOUR`, `METRICS_PER_HOUR`
- `JOB_SCHEDULER_POLL_SECONDS`, `JOB_WORKER_POLL_SECONDS`
- `JOB_CATCHUP_MAX_ENQUEUE`, `JOB_CATCHUP_SPREAD_HOURS`
- `JOB_SCHEDULE_PHASE_SECONDS`, `JOB_ENQUEUE_JITTER_SECONDS`
- `DEAL_MAX_CONCURRENCY`, `RETRIEVAL_MAX_CONCURRENCY`
- `USE_ONLY_APPROVED_PROVIDERS`

## Source of Truth Links

- Job schedule entity: [`job-schedule-state.entity.ts`](../apps/backend/src/database/entities/job-schedule-state.entity.ts)
- Job schedule repository: [`job-schedule.repository.ts`](../apps/backend/src/jobs/repositories/job-schedule.repository.ts)
- Scheduler + workers: [`jobs.service.ts`](../apps/backend/src/jobs/jobs.service.ts)
- Provider sync (SP registry): [`wallet-sdk.service.ts`](../apps/backend/src/wallet-sdk/wallet-sdk.service.ts)
- Job metrics: [`metrics-prometheus.module.ts`](../apps/backend/src/metrics-prometheus/metrics-prometheus.module.ts)
