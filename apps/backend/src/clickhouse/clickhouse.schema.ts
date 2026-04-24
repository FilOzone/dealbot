/**
 * ClickHouse DDL statements executed on startup via CREATE DATABASE/TABLE IF NOT EXISTS.
 * Order matters: database must be created before tables.
 */
export function buildMigrations(database: string): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS ${database}.data_storage_checks
(
    timestamp                   DateTime64(3, 'UTC'),    -- when deal entity was saved

    probe_location              LowCardinality(String),  -- dealbot location
    sp_address                  String,                  -- storage provider address
    sp_id                       Nullable(UInt64),        -- storage provider numeric id
    sp_name                     Nullable(String),        -- storage provider name

    deal_id                     UUID,                    -- id assigned by dealbot
    piece_cid                   Nullable(String),        -- null if upload failed
    piece_id                    Nullable(UInt64),        -- on-chain piece id
    file_size_bytes             Nullable(UInt64),        -- raw file size before CAR encoding
    piece_size_bytes            Nullable(UInt64),        -- piece size after CAR encoding

    status                      LowCardinality(String),  -- DealStatus: 'pending' | 'uploaded' | 'piece_added' | 'piece_confirmed' | 'deal_created' | 'failed'
    error_code                  LowCardinality(Nullable(String)),

    upload_started_at           Nullable(DateTime64(3, 'UTC')),  -- when executeUpload() was called
    upload_ended_at             Nullable(DateTime64(3, 'UTC')),  -- when onStored event fired

    pieces_added_at             Nullable(DateTime64(3, 'UTC')),  -- when onPiecesAdded event fired
    pieces_confirmed_at         Nullable(DateTime64(3, 'UTC')),  -- when onPiecesConfirmed event fired

    ipni_status                 LowCardinality(Nullable(String)), -- 'pending' | 'sp_indexed' | 'sp_advertised' | 'verified' | 'failed'
    ipni_indexed_at             Nullable(DateTime64(3, 'UTC')),   -- when dealbot first observed SP_INDEXED (accuracy limited to poll interval)
    ipni_advertised_at          Nullable(DateTime64(3, 'UTC')),   -- when dealbot first observed SP_ADVERTISED (accuracy limited to poll interval)
    ipni_verified_at            Nullable(DateTime64(3, 'UTC')),   -- when dealbot confirmed root CID findable via IPNI
    ipni_verified_cids_count    Nullable(UInt32),                 -- CIDs confirmed findable via IPNI
    ipni_unverified_cids_count  Nullable(UInt32)                  -- CIDs checked but not findable
) ENGINE MergeTree()
  PRIMARY KEY (probe_location, sp_address, timestamp)
  PARTITION BY toStartOfMonth(timestamp)
  TTL toDateTime(timestamp) + INTERVAL 1 YEAR`,

    `CREATE TABLE IF NOT EXISTS ${database}.retrieval_checks
(
    timestamp               DateTime64(3, 'UTC'),    -- when retrieval entity was saved
    probe_location          LowCardinality(String),  -- dealbot location
    sp_address              String,                  -- storage provider address
    sp_id                   Nullable(UInt64),        -- storage provider numeric id
    sp_name                 Nullable(String),        -- storage provider name

    deal_id                 Nullable(UUID),          -- id of deal assigned by dealbot
    retrieval_id            UUID,                    -- id of retrieval assigned by dealbot
    service_type            LowCardinality(String),  -- 'direct_sp' | 'ipfs_pin'

    status                  LowCardinality(String),  -- RetrievalStatus: 'pending' | 'in_progress' | 'success' | 'failed' | 'timeout'
    http_response_code      Nullable(UInt16),        -- raw HTTP status; null on transport failure

    first_byte_ms           Nullable(Float64),       -- time from request start to first response byte
    last_byte_ms            Nullable(Float64),       -- time from request start to last response byte
    bytes_retrieved         Nullable(UInt64)         -- size of received data in bytes
) ENGINE MergeTree()
  PRIMARY KEY (probe_location, sp_address, timestamp)
  PARTITION BY toStartOfMonth(timestamp)
  TTL toDateTime(timestamp) + INTERVAL 1 YEAR`,

    `CREATE TABLE IF NOT EXISTS ${database}.data_retention_challenges
(
    timestamp               DateTime64(3, 'UTC'),   -- when the poll ran and detected these periods
    probe_location          LowCardinality(String), -- dealbot location
    sp_address              String,                 -- storage provider address
    sp_id                   Nullable(UInt64),       -- storage provider numeric id
    sp_name                 Nullable(String),       -- storage provider name

    total_proving_periods   UInt32,                 -- cumulative total proving periods from subgraph at poll time
    total_faulted_periods   UInt32                  -- cumulative total faulted periods from subgraph at poll time
) ENGINE MergeTree()
  PRIMARY KEY (probe_location, sp_address, timestamp)
  PARTITION BY toStartOfMonth(timestamp)
  TTL toDateTime(timestamp) + INTERVAL 1 YEAR`,
  ];
}
