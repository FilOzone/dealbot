#!/usr/bin/env bash
set -euo pipefail

# Supabase Backup and Restore Script
# Supports backup, restore, and combined backup+restore operations
# Usage: ./supabase-backup-restore.sh <action> [options]

VERSION="1.1.0"

# Color codes for output (Using printf instead of echo -e for better compatibility)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Logging functions (All routed to stderr via >&2 to prevent subshell corruption)
log() { printf "${BLUE}[%s]${NC} %s\n" "$(date -u +"%Y-%m-%d %H:%M:%S UTC")" "$*" >&2; }
log_success() { printf "${GREEN}[%s] ✓${NC} %s\n" "$(date -u +"%Y-%m-%d %H:%M:%S UTC")" "$*" >&2; }
log_error() { printf "${RED}[%s] ✗${NC} %s\n" "$(date -u +"%Y-%m-%d %H:%M:%S UTC")" "$*" >&2; }
log_warning() { printf "${YELLOW}[%s] ⚠${NC} %s\n" "$(date -u +"%Y-%m-%d %H:%M:%S UTC")" "$*" >&2; }

# Usage information
usage() {
    cat << EOF
Supabase Backup and Restore Script v${VERSION}

USAGE:
    $0 <action> [options]

ACTIONS:
    backup              Create a backup of the Supabase database
    restore             Restore a backup to the Supabase database
    test                Backup + restore to temporary database (validation)

OPTIONS:
    -u, --db-url URL           Database connection URL (required if env var not set)
    -d, --backup-dir DIR       Backup directory (default: ./backups/TIMESTAMP)
    -t, --target-db URL        Target database URL for restore (optional)
    -s, --schema SCHEMA        Schema to backup/restore (default: public)
    -h, --help                 Show this help message

ENVIRONMENT VARIABLES:
    SUPABASE_DB_URL            Database connection URL (use this instead of --db-url)

EOF
    exit 0
}

# Parse command line arguments
parse_args() {
    ACTION=""
    DB_URL="${SUPABASE_DB_URL:-}"
    BACKUP_DIR=""
    TARGET_DB_URL=""
    SCHEMA="public"

    if [[ $# -eq 0 ]]; then
        usage
    fi

    ACTION="$1"
    shift

    while [[ $# -gt 0 ]]; do
        case $1 in
            -u|--db-url)
                if [[ -n "${2:-}" ]]; then
                    DB_URL="$2"
                    log_warning "Passing DB URL via CLI arguments can expose credentials in process lists. Consider using SUPABASE_DB_URL environment variable."
                    shift 2
                else
                    log_error "Missing value for $1"
                    exit 1
                fi
                ;;
            -d|--backup-dir)
                if [[ -n "${2:-}" ]]; then
                    BACKUP_DIR="$2"
                    shift 2
                else
                    log_error "Missing value for $1"
                    exit 1
                fi
                ;;
            -t|--target-db)
                if [[ -n "${2:-}" ]]; then
                    TARGET_DB_URL="$2"
                    shift 2
                else
                    log_error "Missing value for $1"
                    exit 1
                fi
                ;;
            -s|--schema)
                if [[ -n "${2:-}" ]]; then
                    SCHEMA="$2"
                    shift 2
                else
                    log_error "Missing value for $1"
                    exit 1
                fi
                ;;
            -h|--help)
                usage
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                ;;
        esac
    done

    # Validate action
    if [[ "$ACTION" != "backup" && "$ACTION" != "restore" && "$ACTION" != "test" ]]; then
        log_error "Invalid action: $ACTION"
        usage
    fi

    if [[ -z "$DB_URL" ]]; then
        log_error "Database URL is required. Set SUPABASE_DB_URL environment variable or use --db-url."
        exit 1
    fi
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."

    if ! command -v supabase &> /dev/null; then
        log_error "Supabase CLI not found. Install it from: https://supabase.com/docs/guides/cli"
        exit 1
    fi
    log_success "Supabase CLI: $(supabase --version)"

    if ! command -v psql &> /dev/null; then
        log_error "PostgreSQL client (psql) not found. Install PostgreSQL client tools."
        exit 1
    fi
    log_success "PostgreSQL client: $(psql --version | head -n1)"

    if ! command -v perl &> /dev/null; then
        log_warning "Perl not found. Schema scrubbing may not work correctly."
    fi

    log "Testing database connection..."
    if ! psql "$DB_URL" -c "SELECT version();" &> /dev/null; then
        log_error "Failed to connect to database. Check your connection URL."
        exit 1
    fi
    log_success "Database connection successful"
}

# Create backup
do_backup() {
    local timestamp=$(date +%s)
    local backup_dir="${BACKUP_DIR:-./backups/${timestamp}}"

    # Use a subshell to isolate the directory change (cd) and redirect stdout to stderr
    # This guarantees the ONLY thing output to stdout is the final backup_dir path
    (
        exec >&2 # Redirect all stdout in this subshell to stderr

        log "=========================================="
        log "Creating Backup"
        log "Timestamp: $timestamp"
        log "Directory: $backup_dir"
        log "Schema: $SCHEMA"
        log "=========================================="

        mkdir -p "$backup_dir"
        cd "$backup_dir"

        local start_time=$(date +%s)

        log "Step 1/4: Dumping database roles..."
        if ! supabase db dump --db-url "$DB_URL" -f roles.sql --role-only; then
            log_error "Failed to dump roles"
            exit 1
        fi
        log_success "Roles dumped successfully"

        log "Step 2/4: Dumping database schema..."
        if ! supabase db dump --db-url "$DB_URL" -f schema.sql --schema "$SCHEMA"; then
            log_error "Failed to dump schema"
            exit 1
        fi
        log_success "Schema dumped successfully"

        log "Step 3/4: Dumping database data..."
        if ! supabase db dump --db-url "$DB_URL" -f data.sql --use-copy --data-only --schema "$SCHEMA"; then
            log_error "Failed to dump data"
            exit 1
        fi
        log_success "Data dumped successfully"

        log "Step 4/4: Creating backup metadata..."
        local backup_size=$(du -sk . | awk '{print $1 * 1024}')
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))

        cat > metadata.json << EOF
{
  "timestamp": $timestamp,
  "date": "$(date -u +"%Y-%m-%d %H:%M:%S UTC")",
  "schema": "$SCHEMA",
  "backup_size_bytes": $backup_size,
  "duration_seconds": $duration,
  "files": {
    "roles": "roles.sql",
    "schema": "schema.sql",
    "data": "data.sql"
  }
}
EOF
        log_success "Metadata created"

        log "=========================================="
        log_success "Backup completed successfully"
        log "Location: $backup_dir"
        log "Size: $(numfmt --to=iec-i --suffix=B $backup_size 2>/dev/null || echo "${backup_size} bytes")"
        log "Duration: ${duration}s"
        log "=========================================="
    ) || return 1

    # Safely print only the directory to stdout for the caller to capture
    echo "$backup_dir"
}

# Scrub schema file
scrub_schema() {
    local schema_file="$1"
    log "Scrubbing supabase_admin references from schema..."
    
    if command -v perl &> /dev/null; then
        if perl -pi -e 's/supabase_admin/postgres/g' "$schema_file"; then
            log_success "Schema scrubbed successfully"
            return 0
        else
            log_warning "Failed to scrub schema with perl"
            return 1
        fi
    else
        log_warning "Perl not available, skipping schema scrubbing"
        return 0
    fi
}

# Restore backup
do_restore() {
    local backup_dir="${BACKUP_DIR}"
    local target_url="${TARGET_DB_URL:-$DB_URL}"

    if [[ -z "$backup_dir" ]] || [[ ! -d "$backup_dir" ]]; then
        log_error "Valid backup directory is required for restore. Path provided: ${backup_dir:-None}"
        exit 1
    fi

    log "=========================================="
    log "Restoring Backup"
    log "Source: $backup_dir"
    log "Target: ${target_url%%@*}@***"  # Hide password in logs
    log "=========================================="

    # Run restore sequence in a subshell to prevent directory pollution
    (
        cd "$backup_dir"

        log "Validating backup files..."
        for file in roles.sql schema.sql data.sql; do
            if [[ ! -f "$file" ]]; then
                log_error "Backup file not found: $file"
                exit 1
            fi
            local size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null)
            log "  - $file: $(numfmt --to=iec-i --suffix=B "$size" 2>/dev/null || echo "${size} bytes")"
        done
        log_success "Backup files validated"

        scrub_schema "schema.sql"

        log "Restoring backup to database..."
        local start_time=$(date +%s)


        if ! psql \
            --single-transaction \
            --variable ON_ERROR_STOP=1 \
            --file roles.sql \
            --file schema.sql \
            --command 'SET session_replication_role = replica' \
            --file data.sql \
            --dbname "$target_url" >/dev/null; then
            log_error "Failed to restore backup"
            exit 1
        fi

        local end_time=$(date +%s)
        local duration=$((end_time - start_time))

        log_success "Backup restored successfully"
        log "Duration: ${duration}s"

        log "Validating restored database..."
        local table_count=$(psql "$target_url" -t -c "SELECT count(*) FROM pg_tables WHERE schemaname = '$SCHEMA';" 2>&1 | xargs)
        log_success "Found $table_count tables in schema '$SCHEMA'"

        log "=========================================="
        log_success "Restore completed successfully"
        log "Duration: ${duration}s"
        log "Tables: $table_count"
        log "=========================================="
    ) || return 1
}

# Test backup and restore
do_test() {
    log "=========================================="
    log "Backup + Restore Test"
    log "This will create a backup and restore it to a temporary database"
    log "=========================================="

    log "Phase 1: Creating backup..."
    local backup_dir
    backup_dir=$(do_backup) || {
        log_error "Backup phase failed"
        return 1
    }

    local timestamp=$(date +%s)
    local test_db_name="restore_test_${timestamp}"
    
    # Define cleanup function to be triggered on script exit
    cleanup_test_db() {
        log "Phase 5: Cleaning up test database..."
        if psql "$DB_URL" -c "DROP DATABASE IF EXISTS \"${test_db_name}\" WITH (FORCE);" >/dev/null 2>&1; then
            log_success "Test database dropped"
        else
            log_warning "Failed to drop test database: $test_db_name"
        fi
    }
    
    # Set the EXIT trap. This guarantees cleanup runs even if the script crashes or is killed midway.
    trap cleanup_test_db EXIT

    log "Phase 2: Creating temporary test database..."
    if ! psql "$DB_URL" -c "CREATE DATABASE \"${test_db_name}\";" >/dev/null 2>&1; then
        log_error "Failed to create test database"
        return 1
    fi
    log_success "Test database created: $test_db_name"

    # Construct test database URL dynamically
    local test_db_url="${DB_URL%/*}/${test_db_name}"

    log "Phase 3: Restoring backup to test database..."
    # Execute restore using the temporary variables
    BACKUP_DIR="$backup_dir" TARGET_DB_URL="$test_db_url" do_restore
    local restore_result=$?

    if [[ $restore_result -eq 0 ]]; then
        log "Phase 4: Validating restoration..."
        local count=$(psql "$test_db_url" -t -c "SELECT count(*) FROM pg_tables WHERE schemaname = '$SCHEMA';" 2>&1 | xargs)
        log "  - Total tables found in schema '$SCHEMA': $count"

        log "=========================================="
        log_success "Test completed successfully"
        log "Backup location: $backup_dir"
        log "=========================================="
        return 0
    else
        log "=========================================="
        log_error "Test failed during restore phase"
        log "=========================================="
        return 1
    fi
}

# Main execution
main() {
    parse_args "$@"
    check_prerequisites

    case "$ACTION" in
        backup)
            do_backup
            ;;
        restore)
            do_restore
            ;;
        test)
            do_test
            ;;
        *)
            log_error "Unknown action: $ACTION"
            exit 1
            ;;
    esac
}

main "$@"