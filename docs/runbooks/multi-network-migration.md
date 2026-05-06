# Multi-Network Migration Runbook

This runbook walks operators through enabling the `network` column added by
`AddNetworkColumn1776790420000` (`apps/backend/src/database/migrations/1776790420000-AddNetworkColumn.ts`).
The migration partitions runtime state (storage providers, deals, job schedules,
data-retention baselines) by blockchain network so a single dealbot instance —
or two cooperating instances — can safely operate on multiple networks
(e.g. `mainnet` and `calibration`) without rows colliding under shared keys.

> Audience: operators upgrading an existing single-network deployment. Fresh
> deployments only need to set `NETWORK` (or `DEALBOT_LEGACY_NETWORK_BACKFILL`)
> to a supported value before first start; the migration runs automatically.

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

The migration **fails fast** if the backfill network is not supplied or is not
in `SUPPORTED_NETWORKS` (see `apps/backend/src/common/constants.ts`).

## Pre-migration checklist

1. **Take a database backup.** This is a structural migration affecting four
   tables and a foreign key. See `docs/runbooks/supabase-backup-restore.md`.
2. **Identify the network of all existing rows.** Pre-migration, the deployment
   has been single-network. Confirm with operations which network's data
   currently lives in the database. Allowed values: `calibration`, `mainnet`.
3. **Set `DEALBOT_LEGACY_NETWORK_BACKFILL`** (preferred) or rely on the legacy
   `NETWORK` env var so the migration can backfill the new column.

   ```bash
   export DEALBOT_LEGACY_NETWORK_BACKFILL=mainnet   # or: calibration
   ```

4. **Stop writers** (or scale to zero) for the duration of the migration so no
   rows are inserted with the old default-only `network` column shape.

## Running the migration

The migration runs as part of the normal startup sequence
(`migrationsRun: true`). To run it explicitly:

```bash
pnpm --filter @dealbot/backend run typeorm:migration:run
```

If the env var is missing or invalid, startup aborts with:

```
AddNetworkColumn migration requires DEALBOT_LEGACY_NETWORK_BACKFILL (or legacy NETWORK)
to be set to one of: calibration, mainnet. Got: ""
```

Set the env var and rerun.

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

   All groups should match the backfill network.

3. **Restart the backend** and confirm the providers refresh job runs without
   errors. The Prometheus `network` label on app metrics should reflect the
   configured network.

## Expanding to a second network

Once the schema is migrated, adding a second network to a deployment is
purely an application-level change:

1. Update the deployment configuration to point at the new network's RPC and
   contracts (or run a second backend instance dedicated to it).
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

The down migration is destructive when rows for multiple networks exist. The
operator must declare which network's data to preserve via
`DEALBOT_LEGACY_NETWORK_BACKFILL` (or legacy `NETWORK`); rows from any other
network are deleted before the schema collapses back to single-network shape.

```bash
export DEALBOT_LEGACY_NETWORK_BACKFILL=mainnet
pnpm --filter @dealbot/backend run typeorm:migration:revert
```

After revert:

- The `network_enum` type is dropped.
- `storage_providers` reverts to a single-column `(address)` primary key.
- The `deals → storage_providers` FK reverts to `(sp_address) → (address)`.
- The `job_schedule_state_job_type_sp_unique` constraint is restored.

> Always take a fresh backup before reverting — deleted-other-network rows
> are not recoverable from the running database afterwards.
