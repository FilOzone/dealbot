#!/usr/bin/env bash
set -euo pipefail

# Backup Restoration Test Script
# Tests that Supabase backups can be successfully restored using Supabase CLI
# Emits metrics to production Pushgateway for monitoring

# Required environment variables
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
: "${PROJECT_LABEL:?PROJECT_LABEL is required (prod or staging)}"

# Optional environment variables
PUSHGATEWAY_URL="${PUSHGATEWAY_URL:-}"

# Test configuration
TIMESTAMP=$(date +%s)
LOG_FILE="/tmp/backup-restore-test-${PROJECT_LABEL}-${TIMESTAMP}.log"
BACKUP_DIR="/tmp/backup-${PROJECT_LABEL}-${TIMESTAMP}"
TEST_DB_NAME="restore_test_${PROJECT_LABEL}_${TIMESTAMP}"

# Metrics
RESTORE_OK=0
RESTORE_DURATION_SECONDS=0
BACKUP_SIZE_BYTES=0
TABLES_RESTORED=0
ERROR_MESSAGE=""

# Logging functions
log() {
    echo "[$(date -u +"%Y-%m-%d %H:%M:%S UTC")] $*" | tee -a "$LOG_FILE"
}

log_error() {
    echo "[$(date -u +"%Y-%m-%d %H:%M:%S UTC")] ERROR: $*" | tee -a "$LOG_FILE" >&2
}

# Cleanup function
cleanup() {
    local exit_code=$?
    log "Cleaning up temporary files..."
    
    # Drop test database if it exists
    if [[ -n "${TEST_DB_NAME:-}" ]]; then
        local drop_query="DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE);"
        log "Deleting database: $TEST_DB_NAME with query: $drop_query"
        psql "$SUPABASE_DB_URL" -c "$drop_query" || log_error "Failed to drop database $TEST_DB_NAME"
    fi
    
    # Remove backup files
    rm -rf "$BACKUP_DIR" 2>/dev/null || true
    
    log "Cleanup complete"
    exit $exit_code
}

trap cleanup EXIT INT TERM

# Emit metrics to Pushgateway
emit_metrics() {
    if [[ -z "$PUSHGATEWAY_URL" ]]; then
        log "PUSHGATEWAY_URL not set, skipping metrics emission"
        return 0
    fi
    
    log "Emitting metrics to Pushgateway..."
    
    local metrics
    metrics=$(cat <<EOF
# HELP supabase_backup_restore_ok Backup restoration test passed (1) or failed (0)
# TYPE supabase_backup_restore_ok gauge
supabase_backup_restore_ok{project="$PROJECT_LABEL",source="ci"} $RESTORE_OK
# HELP supabase_backup_restore_duration_seconds Time taken to restore backup
# TYPE supabase_backup_restore_duration_seconds gauge
supabase_backup_restore_duration_seconds{project="$PROJECT_LABEL",source="ci"} $RESTORE_DURATION_SECONDS
# HELP supabase_backup_restore_last_test_seconds Timestamp of last restoration test
# TYPE supabase_backup_restore_last_test_seconds gauge
supabase_backup_restore_last_test_seconds{project="$PROJECT_LABEL",source="ci"} $TIMESTAMP
# HELP supabase_backup_size_bytes Size of backup files in bytes
# TYPE supabase_backup_size_bytes gauge
supabase_backup_size_bytes{project="$PROJECT_LABEL",source="ci"} $BACKUP_SIZE_BYTES
EOF
)
    
    if curl -sf -X POST "$PUSHGATEWAY_URL/metrics/job/backup_restore_ci/instance/${PROJECT_LABEL}" \
        --data-binary "$metrics" \
        -H "Content-Type: text/plain; version=0.0.4"; then
        log "Metrics successfully pushed to Pushgateway"
    else
        log_error "Failed to push metrics to Pushgateway"
    fi
}

# Main test function
run_restore_test() {
    log "=========================================="
    log "Backup Restoration Test"
    log "Database: $PROJECT_LABEL"
    log "Timestamp: $TIMESTAMP"
    log "=========================================="
    
    local start_time
    start_time=$(date +%s)
    
    # Create backup directory
    mkdir -p "$BACKUP_DIR"
    cd "$BACKUP_DIR"
    
    # Step 1: Dump roles
    log "Step 1/5: Dumping database roles..."
    if ! supabase db dump --db-url "$SUPABASE_DB_URL" -f roles.sql --role-only 2>&1 | tee -a "$LOG_FILE"; then
        ERROR_MESSAGE="Failed to dump roles"
        log_error "$ERROR_MESSAGE"
        return 1
    fi
    log "✓ Roles dumped successfully"
    
    # Step 2: Dump schema
    log "Step 2/5: Dumping database schema..."
    if ! supabase db dump --db-url "$SUPABASE_DB_URL" -f schema.sql --schema public 2>&1 | tee -a "$LOG_FILE"; then
        ERROR_MESSAGE="Failed to dump schema"
        log_error "$ERROR_MESSAGE"
        return 1
    fi
    log "✓ Schema dumped successfully"
    
    # Step 3: Dump data
    log "Step 3/5: Dumping database data..."
    if ! supabase db dump --db-url "$SUPABASE_DB_URL" -f data.sql --use-copy --data-only --schema public 2>&1 | tee -a "$LOG_FILE"; then
        ERROR_MESSAGE="Failed to dump data"
        log_error "$ERROR_MESSAGE"
        return 1
    fi
    log "✓ Data dumped successfully"
    
    # Calculate backup size
    BACKUP_SIZE_BYTES=$(du -sk "$BACKUP_DIR" | awk '{print $1 * 1024}')
    log "Backup size: $BACKUP_SIZE_BYTES bytes"
    
    # Validate backup files
    log "Step 4/5: Validating backup files..."
    for file in roles.sql schema.sql data.sql; do
        if [[ ! -f "$file" ]]; then
            ERROR_MESSAGE="Backup file $file not found"
            log_error "$ERROR_MESSAGE"
            return 1
        fi
        
        local size
        size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null)
        if [[ $size -lt 10 ]]; then
            ERROR_MESSAGE="Backup file $file is too small ($size bytes)"
            log_error "$ERROR_MESSAGE"
            return 1
        fi
        
        log "  - $file: $size bytes"
    done
    log "✓ Backup files validated"

    # Step 4.5: Scrub the schema.sql file of supabase_admin references
    log "Step 4.5/5: Scrubbing supabase_admin references..."
    
    # We use perl here instead of sed for better cross-platform (Mac/Linux) compatibility
    if ! perl -pi -e 's/supabase_admin/postgres/g' schema.sql 2>&1 | tee -a "$LOG_FILE"; then
        ERROR_MESSAGE="Failed to scrub supabase_admin from backup files"
        log_error "$ERROR_MESSAGE"
        return 1
    fi
    log "✓ schema.sql file scrubbed successfully"
    
    # Step 5: Test restoration
    log "Step 5/5: Testing restoration to temporary database..."
    
    # Create test database
    log "Creating test database: $TEST_DB_NAME"
    if ! psql "$SUPABASE_DB_URL" -c "CREATE DATABASE ${TEST_DB_NAME};" 2>&1 | tee -a "$LOG_FILE"; then
        ERROR_MESSAGE="Failed to create test database"
        log_error "$ERROR_MESSAGE"
        return 1
    fi
    log "✓ Created Database: $TEST_DB_NAME"
    
    # Construct test database URL
    local test_db_url
    test_db_url="${SUPABASE_DB_URL%/*}/${TEST_DB_NAME}"

    # Test database connection
    log "Testing database connection..."
    if ! psql "$test_db_url" -c "SELECT version();" &> /dev/null; then
        log_error "Failed to connect to test database"
        exit 1
    fi
    log "✓ Test Database connection successful"

    
    # Restore to test database
    log "Restoring backup to test database..."
    if ! psql \
        --single-transaction \
        --variable ON_ERROR_STOP=1 \
        --file roles.sql \
        --file schema.sql \
        --command 'SET session_replication_role = replica' \
        --file data.sql \
        --dbname "$test_db_url" 2>&1 | tee -a "$LOG_FILE"; then
        ERROR_MESSAGE="Failed to restore backup"
        log_error "$ERROR_MESSAGE"
        return 1
    fi
    log "✓ Backup restored successfully"
    
    # Validate restoration
    log "Validating restored database..."
    
    # Count tables
    TABLES_RESTORED=$(psql "$test_db_url" -t -c "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema');" 2>&1 | xargs)
    
    if [[ -z "$TABLES_RESTORED" ]] || [[ "$TABLES_RESTORED" -eq 0 ]]; then
        ERROR_MESSAGE="No tables found in restored database"
        log_error "$ERROR_MESSAGE"
        return 1
    fi
    
    log "✓ Found $TABLES_RESTORED tables in restored database"
    
    # Verify key dealbot tables exist
    log "Verifying dealbot tables..."
    local required_tables=("deals" "retrievals" "storage_providers")
    for table in "${required_tables[@]}"; do
        if ! psql "$test_db_url" -t -c "SELECT 1 FROM pg_tables WHERE tablename = '$table';" 2>&1 | grep -q 1; then
            ERROR_MESSAGE="Required table '$table' not found in restored database"
            log_error "$ERROR_MESSAGE"
            return 1
        fi
        log "  ✓ Table '$table' exists"
    done
    
    # Count records in key tables
    log "Checking record counts..."
    for table in "${required_tables[@]}"; do
        local count
        count=$(psql "$test_db_url" -t -c "SELECT count(*) FROM $table;" 2>&1 | xargs)
        log "  - $table: $count records"
    done
    
    # Calculate duration
    local end_time
    end_time=$(date +%s)
    RESTORE_DURATION_SECONDS=$((end_time - start_time))
    
    log "=========================================="
    log "✓ Restoration test PASSED"
    log "Duration: ${RESTORE_DURATION_SECONDS}s"
    log "Tables restored: $TABLES_RESTORED"
    log "Backup size: $BACKUP_SIZE_BYTES bytes"
    log "=========================================="
    
    RESTORE_OK=1
    return 0
}

# Main execution
main() {
    log "Starting backup restoration test for $PROJECT_LABEL database"
    
    # Verify Supabase CLI is installed
    if ! command -v supabase &> /dev/null; then
        log_error "Supabase CLI not found. Please install it first."
        exit 1
    fi
    
    log "Supabase CLI version: $(supabase --version)"
    
    # Verify psql is available
    if ! command -v psql &> /dev/null; then
        log_error "psql not found. Please install PostgreSQL client."
        exit 1
    fi
    
    # Test database connection
    log "Testing database connection..."
    if ! psql "$SUPABASE_DB_URL" -c "SELECT version();" &> /dev/null; then
        log_error "Failed to connect to database"
        exit 1
    fi
    log "✓ Database connection successful"
    
    # Run the restoration test
    if run_restore_test; then
        log "Restoration test completed successfully"
        emit_metrics
        exit 0
    else
        log_error "Restoration test failed: ${ERROR_MESSAGE:-Unknown error}"
        emit_metrics
        exit 1
    fi
}

main "$@"
