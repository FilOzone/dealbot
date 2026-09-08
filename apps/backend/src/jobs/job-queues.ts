export const SP_WORK_QUEUE = "sp.work";
export const DATA_RETENTION_POLL_QUEUE = "data.retention.poll";
export const PROVIDERS_REFRESH_QUEUE = "providers.refresh";
export const PULL_PIECE_CLEANUP_QUEUE = "pull.piece.cleanup";
/**
 * Both cleanup jobs share one singleton queue so they never run concurrently: each walks the
 * whole wallet, and on a large wallet two simultaneous walks would double the RPC load for no
 * benefit. Serialising also means the sweep's own fetch always observes pruning's terminations
 * rather than a snapshot taken before them.
 */
export const SP_CLEANUP_QUEUE = "sp.cleanup";
