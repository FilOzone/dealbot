export const SP_WORK_QUEUE = "sp.work";
// Legacy queues: no longer scheduled or worked, but rows may still exist in
// `pgboss.job` until they age out. Kept so job metrics still identify them.
export const LEGACY_METRICS_QUEUE = "metrics.run";
export const LEGACY_METRICS_CLEANUP_QUEUE = "metrics.cleanup";
export const LEGACY_DEAL_QUEUE = "deal.run";
export const LEGACY_RETRIEVAL_QUEUE = "retrieval.run";
export const DATA_RETENTION_POLL_QUEUE = "data.retention.poll";
export const PROVIDERS_REFRESH_QUEUE = "providers.refresh";
