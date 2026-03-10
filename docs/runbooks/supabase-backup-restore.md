# Supabase Backup and Restore Runbook

Operational procedures for backing up and restoring the Supabase database.

**Official Documentation:**
- [Supabase Backups](https://supabase.com/docs/guides/platform/backups) - PITR, automated backups, retention policies
- [Backup & Restore Guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) - CLI-based backup and restore

## Prerequisites

Requires Supabase CLI and PostgreSQL client:

```bash
# macOS
brew install supabase/tap/supabase postgresql

# Linux
curl -fsSL https://supabase.com/install.sh | sh
sudo apt-get install postgresql-client
```

Get database connection string from Supabase Dashboard → Settings → Database (use Session pooler mode):

```bash
export SUPABASE_DB_URL="postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres"
```

## Script Usage

```bash
# Create backup
./scripts/supabase-backup-restore.sh backup --db-url "$SUPABASE_DB_URL"

# Restore from backup
./scripts/supabase-backup-restore.sh restore --db-url "$SUPABASE_DB_URL" --backup-dir ./backups/1234567890

# Test backup + restore (creates temporary database)
./scripts/supabase-backup-restore.sh test --db-url "$SUPABASE_DB_URL"

# Show help
./scripts/supabase-backup-restore.sh --help
```

Backup directory contains: `roles.sql`, `schema.sql`, `data.sql`, `metadata.json`

## Creating Backups

Create backups before schema migrations, major updates, or production releases:

```bash
export SUPABASE_DB_URL="postgresql://..."
./scripts/supabase-backup-restore.sh backup --db-url "$SUPABASE_DB_URL"
```

Custom backup location:

```bash
./scripts/supabase-backup-restore.sh backup --db-url "$SUPABASE_DB_URL" --backup-dir ./my-backups/pre-migration
```

## Restoring Backups

Restore to staging:

```bash
export SUPABASE_STAGING_DB_URL="postgresql://..."
./scripts/supabase-backup-restore.sh restore --db-url "$SUPABASE_STAGING_DB_URL" --backup-dir ./backups/1234567890
```

Verify restoration:

```sql
SELECT COUNT(*) FROM deals;
SELECT COUNT(*) FROM retrievals;
SELECT COUNT(*) FROM storage_providers;
```

Restore to production:

```bash
# 1. Create pre-restore backup
./scripts/supabase-backup-restore.sh backup --db-url "$SUPABASE_DB_URL" --backup-dir ./backups/pre-restore-$(date +%Y%m%d-%H%M%S)

# 2. Restore
./scripts/supabase-backup-restore.sh restore --db-url "$SUPABASE_DB_URL" --backup-dir ./backups/1234567890
```

Restore to different database:

```bash
./scripts/supabase-backup-restore.sh restore --backup-dir ./backups/1234567890 --target-db "postgresql://..."
```

## Testing Backups

Run weekly or after creating important backups:

```bash
./scripts/supabase-backup-restore.sh test --db-url "$SUPABASE_DB_URL"
```

The test creates a backup, restores it to a temporary database, validates tables, and cleans up.

## Troubleshooting

Connection failed:

```bash
# Test connection
psql "$SUPABASE_DB_URL" -c "SELECT version();"

# Check IP allowlist in Supabase dashboard
# Verify connection string format and password
# Use the Session pooler connection string if only ipv4 is supported by ISP
```

Permission denied to create database (affects `test` action only):

```sql
ALTER USER postgres CREATEDB;
```

Restore fails with 'role does not exist':

```bash
# Script auto-scrubs supabase_admin references
# If it fails, manually scrub:
cd backups/1234567890
perl -pi -e 's/supabase_admin/postgres/g' schema.sql
```
