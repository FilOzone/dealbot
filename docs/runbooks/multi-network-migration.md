# Multi-Network Migration Runbook

This runbook walks operators through enabling the `network` column added by
`AddNetworkColumn1776790420000` (`apps/backend/src/database/migrations/1776790420000-AddNetworkColumn.ts`).
The migration partitions runtime state (storage providers, deals, job schedules,
data-retention baselines) by blockchain network so a single dealbot instance —
or two cooperating instances — can safely operate on multiple networks
(e.g. `mainnet` and `calibration`) without rows colliding under shared keys.

Each `<NET>_CLICKHOUSE_URL` selects where that network writes ClickHouse rows.
Multiple networks may use the same database. When the startup migration adds
`network`, it uses the first configured network that initializes that database
as the backfill value. New rows always include their network explicitly.

> Set `DEALBOT_LEGACY_NETWORK_BACKFILL` whenever this Postgres migration still
> needs to run, including on a fresh database with empty tables. Keep it set
> until the Postgres migration has completed.

## What the migration changes

- Creates a shared Postgres `network_enum` type (`'calibration'`, `'mainnet'`).
- Adds a `network network_enum NOT NULL` column to:
  - `storage_providers` (now part of the composite primary key with `address`)
  - `deals`
  - `job_schedule_state` (now part of the composite uniqueness with `job_type, sp_address`)
  - `data_retention_baselines` (now part of the composite primary key with `provider_address`)
- Recreates the `deals → storage_providers` foreign key as a composite
  `(sp_address, network) → (address, network)` reference.
- Replaces the unique `job_schedule_state_job_type_sp_unique` constraint with
  `job_schedule_state_job_type_sp_network_unique`.
- Adds `network` to each configured ClickHouse database. Existing rows use the
  network that first initializes the database; new rows always provide it explicitly.
- Rebuilds each ClickHouse check table with:
  - primary key `(network, probe_location, sp_address, timestamp)`
  - partition key `(network, toStartOfMonth(timestamp))`

The Postgres migration validates the backfill value before running any SQL, so
it is required even when all four tables are empty. The value must be listed in
`SUPPORTED_NETWORKS` (see `apps/backend/src/common/constants.ts`). ClickHouse
does not read this value because startup receives the network associated with
each configured URL.

## Pre-migration checklist

1. **Take a database backup.** This is a structural migration affecting four
   tables and a foreign key. See `docs/runbooks/supabase-backup-restore.md`.
2. **Choose the Postgres backfill network.** For an upgrade, confirm which
   network owns the existing Postgres rows. For a fresh deployment, choose
   either active network; no rows are changed, but validation still requires the
   value. Allowed values: `calibration`, `mainnet`.
3. **Set `DEALBOT_LEGACY_NETWORK_BACKFILL`** (preferred) or keep the legacy
   `NETWORK` env var available. This is required for every deployment that still
   needs to run the Postgres migration.

   ```bash
   export DEALBOT_LEGACY_NETWORK_BACKFILL=mainnet   # or: calibration
   ```

4. **For upgrades, stop all ClickHouse writers** (or scale to zero). Run one
   backend instance until the ClickHouse migration completes, then scale the
   remaining instances back up.
5. **Check ClickHouse capacity.** The key migration copies and replaces one
   table at a time. Keep enough free disk space for a second copy of the largest
   check table.

## Running the migration

The Postgres migration runs as part of the normal startup sequence
(`migrationsRun: true`). Versioned ClickHouse migrations also run during
backend startup and are recorded in the `schema_migrations` table.

ClickHouse uses a `schema_migration_lock` table to prevent two instances from
rebuilding the same database concurrently. If the process terminates without
cleaning up the lock, first confirm that no migration is running, then remove
the stale lock:

```sql
DROP TABLE <database>.schema_migration_lock SYNC;
```

The table replacement uses `EXCHANGE TABLES`, so the ClickHouse database must
use the `Atomic` or `Shared` database engine.

To run the Postgres migration explicitly:

```bash
pnpm --filter dealbot-backend run typeorm:migration:run
```

If the value is missing or invalid, the Postgres migration aborts before
running any SQL, even when its tables are empty:

```
AddNetworkColumn migration requires DEALBOT_LEGACY_NETWORK_BACKFILL (or legacy NETWORK) to be set to one of: calibration, mainnet. Got: ""
```

Set the value and rerun the Postgres migration.

## Post-migration verification

1. **Confirm the enum type exists**:

   ```sql
   SELECT typname FROM pg_type WHERE typname = 'network_enum';
   ```

2. **Confirm every row has a network assigned**:

   ```sql
   SELECT 'storage_providers' AS tbl, network, COUNT(*)
   FROM storage_providers GROUP BY network
   UNION ALL
   SELECT 'deals', network, COUNT(*) FROM deals GROUP BY network
   UNION ALL
   SELECT 'job_schedule_state', network, COUNT(*) FROM job_schedule_state GROUP BY network
   UNION ALL
   SELECT 'data_retention_baselines', network, COUNT(*) FROM data_retention_baselines GROUP BY network;
   ```

   Any rows that existed before the migration should match the backfill
   network. Fresh databases return no groups until Dealbot writes data.

3. **Restart the backend** and confirm the providers refresh job runs without
   errors. The Prometheus `network` label on app metrics should reflect the
   configured network.

4. **Confirm ClickHouse rows have the expected network** for each check table:

   ```sql
   SELECT network, count()
   FROM data_storage_checks
   GROUP BY network;
   ```

   Repeat for `retrieval_checks`, `sampled_retrieval_checks`,
   `data_retention_challenges`, and `pull_checks`.

5. **Confirm the ClickHouse table keys**:

   ```sql
   SELECT name, partition_key, primary_key
   FROM system.tables
   WHERE database = '<database>'
     AND name IN (
       'data_storage_checks',
       'retrieval_checks',
       'sampled_retrieval_checks',
       'data_retention_challenges',
       'pull_checks'
     )
   ORDER BY name;
   ```

   Every row should contain these key expressions in this order:

   - partition key: `network`, `toStartOfMonth(timestamp)`
   - primary key: `network`, `probe_location`, `sp_address`, `timestamp`

## Expanding to a second network

Once the schema is migrated, adding a second network to a deployment is
purely an application-level change:

1. Update the deployment configuration with the new network's RPC, contracts,
   and optional `<NET>_CLICKHOUSE_URL` (or run a second backend instance
   dedicated to it).
2. Trigger a `providers_refresh` job. The wallet SDK service writes new
   `storage_providers` rows with the active `network` value, so the new
   network's providers will not collide with existing rows even if SP
   addresses overlap.
3. Job schedules, deals, and data-retention baselines created from this point
   onward are automatically scoped to the new network.

No database changes are required to onboard a new network — only the existing
`network_enum` values are accepted, so adding networks beyond
`SUPPORTED_NETWORKS` requires extending that constant and adding a follow-up
migration that calls `ALTER TYPE network_enum ADD VALUE 'newnet'`.

## Rolling back

The ClickHouse key migration is forward-only because rolling it back requires
another full table rebuild. Restore the pre-migration ClickHouse backup or add a
new versioned migration if the previous keys must be reinstated.

The Postgres down migration is destructive when rows for multiple networks
exist. The operator must declare which network's data to preserve via
`DEALBOT_LEGACY_NETWORK_BACKFILL` (or legacy `NETWORK`); rows from any other
network are deleted before the schema collapses back to single-network shape.

```bash
export DEALBOT_LEGACY_NETWORK_BACKFILL=mainnet
pnpm --filter dealbot-backend run typeorm:migration:revert
```

After revert:

- The `network_enum` type is dropped.
- `storage_providers` reverts to a single-column `(address)` primary key.
- The `deals → storage_providers` FK reverts to `(sp_address) → (address)`.
- The `job_schedule_state_job_type_sp_unique` constraint is restored.

> Always take a fresh backup before reverting — deleted-other-network rows
> are not recoverable from the running database afterwards.
