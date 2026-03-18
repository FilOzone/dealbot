# Supabase Backup and Restore Runbook

Operational procedures for restoring the Supabase database from automated backups.

## Overview

Supabase provides automated backups with 7-day retention and Point-in-Time Recovery (PITR) for all production databases.

**Key Points:**
- Automated daily backups are enabled (7-day retention)
- Point-in-Time Recovery (PITR) allows restoration to any point within the retention window
- Backups cannot be downloaded; restores must be performed via the Supabase dashboard

## Automated Backups

Supabase automatically creates daily backups of your database. These backups:
- Run daily without manual intervention
- Retain data for 7 days
- Include the entire database (schema, data, roles)
- Cannot be downloaded or accessed directly

## Point-in-Time Recovery (PITR)

PITR enables restoration to any specific moment within the retention window:
- Restore to any timestamp within the last 7 days
- Useful for recovering from accidental data deletion or corruption
- More granular than daily backups alone

## Restoring from Backup

All restores must be performed through the Supabase dashboard.

### Access the Restore Interface

1. Navigate to your project in the Supabase dashboard
2. Go to **Database** → **Backups**
3. View available backups and PITR timeline

### Restore Options

**Option 1: Restore from Daily Backup**
1. Select a daily backup from the list
2. Click **Restore**
3. Confirm the restoration

**Option 2: Restore to Specific Time (PITR)**
1. Click **Point-in-Time Recovery**
2. Select the desired date and time
3. Confirm the restoration

### Post-Restore Verification

After restoration, verify data integrity:

```sql
-- Check record counts
SELECT COUNT(*) FROM deals;
SELECT COUNT(*) FROM retrievals;
SELECT COUNT(*) FROM storage_providers;

-- Verify recent data
SELECT * FROM deals ORDER BY created_at DESC LIMIT 10;
```

## When to Restore

Common scenarios requiring restoration:
- Accidental data deletion
- Schema migration rollback
- Data corruption recovery
- Testing disaster recovery procedures

## Manual CLI-Based Backups

If you need to create manual backups for migration or testing purposes, refer to the Supabase CLI documentation for current best practices.

## Further Reading

- [Supabase Backups Documentation](https://supabase.com/docs/guides/platform/backups)
- [Backup & Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
