/**
 * ClickHouse DDL statements executed on startup via CREATE DATABASE/TABLE IF NOT EXISTS.
 * Order matters: database must be created before tables.
 */
export function buildMigrations(database: string): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS ${database}.data_storage_checks
(
    timestamp                   DateTime64(3, 'UTC'),
    network                     LowCardinality(String),
    probe_location              LowCardinality(String),
    sp_address                  String,
    sp_name                     Nullable(String),

    deal_id                     UUID,
    piece_cid                   Nullable(String),
    piece_id                    Nullable(UInt64),
    file_size_bytes             Nullable(UInt64),
    piece_size_bytes            Nullable(UInt64),

    status                      LowCardinality(String),
    error_code                  LowCardinality(Nullable(String)),
    retry_count                 UInt8 DEFAULT 0,

    upload_started_at           Nullable(DateTime64(3, 'UTC')),
    upload_ended_at             Nullable(DateTime64(3, 'UTC')),

    pieces_added_at             Nullable(DateTime64(3, 'UTC')),
    pieces_confirmed_at         Nullable(DateTime64(3, 'UTC')),

    ipni_status                 LowCardinality(Nullable(String)),
    ipni_indexed_at             Nullable(DateTime64(3, 'UTC')),
    ipni_advertised_at          Nullable(DateTime64(3, 'UTC')),
    ipni_verified_at            Nullable(DateTime64(3, 'UTC')),
    ipni_verified_cids_count    Nullable(UInt32),
    ipni_unverified_cids_count  Nullable(UInt32)
) ENGINE MergeTree()
  PRIMARY KEY (network, probe_location, sp_address, timestamp)
  PARTITION BY toStartOfMonth(timestamp)
  TTL toDateTime(timestamp) + INTERVAL 1 YEAR`,

    `CREATE TABLE IF NOT EXISTS ${database}.retrieval_checks
(
    timestamp               DateTime64(3, 'UTC'),
    network                 LowCardinality(String),
    probe_location          LowCardinality(String),
    sp_address              String,
    sp_name                 Nullable(String),

    deal_id                 Nullable(UUID),
    retrieval_id            UUID,
    service_type            LowCardinality(String),

    status                  LowCardinality(String),
    http_response_code      Nullable(UInt16),
    retry_count             UInt8 DEFAULT 0,

    ttfb_ms                 Nullable(Float64),
    last_byte_ms            Nullable(Float64),
    bytes_retrieved         Nullable(UInt64)
) ENGINE MergeTree()
  PRIMARY KEY (network, probe_location, sp_address, timestamp)
  PARTITION BY toStartOfMonth(timestamp)
  TTL toDateTime(timestamp) + INTERVAL 1 YEAR`,

    `CREATE TABLE IF NOT EXISTS ${database}.data_retention_challenges
(
    timestamp               DateTime64(3, 'UTC'),
    network                 LowCardinality(String),
    probe_location          LowCardinality(String),
    sp_address              String,
    sp_name                 Nullable(String),

    total_proving_periods   UInt32,
    total_faulted_periods   UInt32
) ENGINE MergeTree()
  PRIMARY KEY (network, probe_location, sp_address, timestamp)
  PARTITION BY toStartOfMonth(timestamp)
  TTL toDateTime(timestamp) + INTERVAL 1 YEAR`,
  ];
}
