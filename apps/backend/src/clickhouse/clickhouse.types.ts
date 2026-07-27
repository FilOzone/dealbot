import type { BlockFetchStatus, CarParseStatus, IpniCheckStatus, ServiceType } from "../database/types.js";

/**
 * Outcome of the piece-fetch step in a sampled retrieval check. ClickHouse-only
 * (the `piece_fetch_status` column of `sampled_retrieval_checks`); deliberately
 * separate from the Postgres-backed {@link RetrievalStatus} so the `skipped`
 * outcome — emitted when piece selection finds no candidate — does not pollute
 * the Postgres enum backing the `Retrieval` entity.
 */
export enum PieceFetchStatus {
  SUCCESS = "success",
  FAILED = "failed",
  SKIPPED = "skipped",
}

/**
 * Typed shape of a row inserted into the `sampled_retrieval_checks` table.
 * Co-located with the DDL so the column list has a single source of truth — the
 * ClickHouse analogue of a TypeORM entity, since ClickHouse writes go through
 * the untyped buffered `ClickhouseService.insert` rather than a repository.
 * A column dropped from the DDL above (e.g. the removed `throughput_bps`)
 * becomes a compile error at the insert site instead of a stale literal.
 */
export type SampledRetrievalCheckRow = {
  timestamp: number;
  probe_location: string;
  sp_address: string;
  sp_id: number | null;
  sp_name: string | null;
  retrieval_id: string;
  piece_cid: string;
  data_set_id: string | number;
  piece_id: string | number;
  raw_size: string | number;
  with_ipfs_indexing: boolean;
  ipfs_root_cid: string | null;
  service_type: ServiceType;
  retrieval_endpoint: string;
  piece_fetch_status: PieceFetchStatus;
  http_response_code: number | null;
  first_byte_ms: number | null;
  last_byte_ms: number | null;
  bytes_retrieved: number | null;
  commp_valid: boolean | null;
  car_status: CarParseStatus;
  car_block_count: number | null;
  block_fetch_endpoint: string | null;
  block_fetch_status: BlockFetchStatus;
  block_fetch_sampled_count: number | null;
  block_fetch_failed_count: number | null;
  ipni_status: IpniCheckStatus;
  ipni_verify_ms: number | null;
  error_message: string | null;
};

/**
 * Maps each ClickHouse table name to its row type. Tables listed here are
 * type-checked by {@link ClickhouseService.insert}; tables not yet listed fall
 * back to `Record<string, unknown>`, so the remaining tables can adopt typed
 * rows incrementally.
 */
export type ClickHouseRows = {
  sampled_retrieval_checks: SampledRetrievalCheckRow;
};
