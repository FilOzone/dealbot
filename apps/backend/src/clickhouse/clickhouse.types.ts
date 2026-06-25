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

