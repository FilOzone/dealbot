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

    `CREATE TABLE IF NOT EXISTS ${database}.anon_retrieval_checks
(
    timestamp                  DateTime64(3, 'UTC'),              -- when the check completed
    probe_location             LowCardinality(String),            -- dealbot location
    sp_address                 String,                            -- storage provider address (lowercased)
    sp_id                      Nullable(UInt64),                  -- storage provider numeric id
    sp_name                    Nullable(String),                  -- storage provider name

    retrieval_id               UUID,                              -- per-event correlation id (log/Prometheus join)

    piece_cid                  String,                            -- piece CID (v2/CommP) sampled from the subgraph
    data_set_id                UInt64,                            -- on-chain data set id
    piece_id                   UInt64,                            -- on-chain piece id within the data set
    raw_size                   UInt64,                            -- raw (unpadded) piece size, bytes
    with_ipfs_indexing         Bool,                              -- whether the piece advertises IPNI metadata
    ipfs_root_cid              Nullable(String),                  -- root CID of the contained DAG; null when not IPFS-indexed

    service_type               LowCardinality(String),            -- 'direct_sp' (only mode for anon retrievals today)
    retrieval_endpoint         String,                            -- URL probed (e.g. {spBaseUrl}/piece/{pieceCid})

    piece_fetch_status         LowCardinality(String),            -- 'success' | 'failed' — outcome of GET /piece/<pieceCid> (HTTP 2xx AND CommP match). CAR/IPNI/block-fetch outcomes live in their own columns.
    http_response_code         Nullable(UInt16),                  -- raw HTTP status; null on transport failure
    first_byte_ms              Nullable(Float64),                 -- time to first response byte
    last_byte_ms               Nullable(Float64),                 -- time to last response byte
    bytes_retrieved            Nullable(UInt64),                  -- bytes received from /piece/{cid}
    throughput_bps             Nullable(UInt64),                  -- effective throughput, bytes per second

    commp_valid                Nullable(Bool),                    -- null when retrieval failed before CommP could be hashed
    car_parseable              Nullable(Bool),                    -- null when CAR validation was skipped (no IPFS indexing or piece fetch failed); true if bytes parsed as a CAR
    car_block_count            Nullable(UInt32),                  -- total number of blocks observed inside the CAR; null when skipped or unparseable
    block_fetch_endpoint       Nullable(String),                  -- gateway base URL probed for block fetch (e.g. {spBaseUrl}/ipfs/); null when skipped
    block_fetch_valid          Nullable(Bool),                    -- null when skipped; true if all sampled blocks fetched + hash-verified
    block_fetch_sampled_count  Nullable(UInt32),                  -- number of blocks sampled and probed via /ipfs/<cid>?format=raw
    block_fetch_failed_count   Nullable(UInt32),                  -- number of sampled blocks that failed (non-2xx, hash mismatch, unsupported codec, or transport error)

    ipni_status                LowCardinality(String),            -- 'valid' | 'invalid' | 'skipped' | 'error' — all-or-nothing across the root CID and the sampled child CIDs (filecoin-pin verifies them as a single batch)
    ipni_verify_ms             Nullable(Float64),                 -- IPNI verification duration; null when skipped

    error_message              Nullable(String)                   -- failure reason; null on success
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

    total_periods_due         UInt32,  -- cumulative proving periods due (confirmed by subgraph)
    total_faulted_periods     UInt32,  -- cumulative periods where proof was not submitted
    total_success_periods     UInt32,  -- cumulative periods where proof was submitted (= due - faulted)
    estimated_overdue_periods UInt32   -- estimated periods not yet recorded on-chain but past deadline
) ENGINE MergeTree()
  PRIMARY KEY (probe_location, sp_address, timestamp)
  PARTITION BY toStartOfMonth(timestamp)
  TTL toDateTime(timestamp) + INTERVAL 1 YEAR`,
  ];
}
