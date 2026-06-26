/**
 * Per-network env var catalog and shared/chain-specific classification.
 *
 * Single source of truth for which per-network vars inherit an unprefixed
 * "shared" value. The loader (resolution precedence) and the Joi schema (which
 * keys carry validation rules) both read this, so they can't drift on whether a
 * var is shared or chain-specific.
 *
 * Resolution precedence for an inheritable var, evaluated per active network:
 *   <NETWORK>_<KEY>  (per-network override)
 *   <KEY>            (unprefixed shared value, inheritable vars only)
 *   default          (applied by the loader)
 *
 * Chain-specific vars never read the unprefixed slot: credentials and chain
 * endpoints obviously differ per network, and provider ids/addresses registered
 * on one chain are meaningless on another, so a shared blocklist would be wrong.
 */

/** Per-network env var base names (the part after the `<NETWORK>_` prefix). */
export const PER_NETWORK_VARS = [
  "WALLET_ADDRESS",
  "WALLET_PRIVATE_KEY",
  "SESSION_KEY_PRIVATE_KEY",
  "RPC_URL",
  "RPC_REQUEST_TIMEOUT_MS",
  "PDP_SUBGRAPH_ENDPOINT",
  "SUBGRAPH_ENDPOINT",
  "CHECK_DATASET_CREATION_FEES",
  "USE_ONLY_APPROVED_PROVIDERS",
  "DEALBOT_DATASET_VERSION",
  "MIN_NUM_DATASETS_FOR_CHECKS",
  "DEALS_PER_SP_PER_HOUR",
  "RETRIEVALS_PER_SP_PER_HOUR",
  "SAMPLED_RETRIEVALS_PER_SP_PER_HOUR",
  "DATASET_CREATIONS_PER_SP_PER_HOUR",
  "DATASET_LIFECYCLE_CHECKS_PER_SP_PER_HOUR",
  "DATASET_LIFECYCLE_CHECK_ENABLED",
  "DEAL_JOB_TIMEOUT_SECONDS",
  "RETRIEVAL_JOB_TIMEOUT_SECONDS",
  "SAMPLED_RETRIEVAL_JOB_TIMEOUT_SECONDS",
  "DATA_SET_CREATION_JOB_TIMEOUT_SECONDS",
  "DATA_SET_LIFECYCLE_CHECK_JOB_TIMEOUT_SECONDS",
  "DATA_RETENTION_POLL_INTERVAL_SECONDS",
  "PROVIDERS_REFRESH_INTERVAL_SECONDS",
  "MAINTENANCE_WINDOWS_UTC",
  "MAINTENANCE_WINDOW_MINUTES",
  "BLOCKED_SP_IDS",
  "BLOCKED_SP_ADDRESSES",
  "PIECE_CLEANUP_PER_SP_PER_HOUR",
  "MAX_PIECE_CLEANUP_RUNTIME_SECONDS",
  "MAX_DATASET_STORAGE_SIZE_BYTES",
  "TARGET_DATASET_STORAGE_SIZE_BYTES",
  "PULL_CHECKS_PER_SP_PER_HOUR",
  "PULL_CHECK_JOB_TIMEOUT_SECONDS",
  "PULL_CHECK_POLL_INTERVAL_SECONDS",
  "PULL_CHECK_PIECE_SIZE_BYTES",
  "PULL_PIECE_CLEANUP_INTERVAL_SECONDS",
] as const;

export type PerNetworkVar = (typeof PER_NETWORK_VARS)[number];

/**
 * Vars that must differ per network and never inherit an unprefixed value:
 * credentials, chain endpoints, and chain-local identifiers (provider ids and
 * addresses registered on one chain don't carry to another).
 */
export const CHAIN_SPECIFIC_NETWORK_VARS = new Set<PerNetworkVar>([
  "WALLET_ADDRESS",
  "WALLET_PRIVATE_KEY",
  "SESSION_KEY_PRIVATE_KEY",
  "RPC_URL",
  "PDP_SUBGRAPH_ENDPOINT",
  "SUBGRAPH_ENDPOINT",
  "DEALBOT_DATASET_VERSION",
  "BLOCKED_SP_IDS",
  "BLOCKED_SP_ADDRESSES",
  // Has a network-dependent default (off on mainnet) because the canary can't
  // auto-terminate PDP data sets when the payer is a Safe multisig (dealbot#546).
  // Kept chain-specific so a shared `=true` can't accidentally enable it on mainnet.
  "DATASET_LIFECYCLE_CHECK_ENABLED",
]);

/** Inheritable vars read the unprefixed shared slot; chain-specific ones don't. */
export function inheritsUnprefixed(varName: PerNetworkVar): boolean {
  return !CHAIN_SPECIFIC_NETWORK_VARS.has(varName);
}

/** Base names that inherit an unprefixed shared value (override → shared → default). */
export const INHERITABLE_NETWORK_VARS: PerNetworkVar[] = PER_NETWORK_VARS.filter(inheritsUnprefixed);
