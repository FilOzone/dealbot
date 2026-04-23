/**
 * Backwards-compatibility shim for the legacy single-network env layout.
 *
 * Before multi-network support, a dealbot deployment was configured with
 * unprefixed variables such as `NETWORK`, `WALLET_PRIVATE_KEY`, `RPC_URL`,
 * `DEALS_PER_SP_PER_HOUR`, etc.  Multi-network support requires a
 * `NETWORKS=...` list plus per-network prefixed variables
 * (`CALIBRATION_WALLET_PRIVATE_KEY`, `MAINNET_RPC_URL`, ...).
 *
 * This shim lets existing deployments roll forward without changing their
 * ConfigMaps/Secrets in the same release as the code rollout: if `NETWORKS`
 * is absent but legacy `NETWORK` is set to a supported value, it is translated
 * into the new shape in place (single-network config only). The translation
 * runs *before* the Joi validation schema is evaluated, so the rest of the
 * code never has to branch on legacy mode.
 *
 * Lifecycle
 * ---------
 * Call `applyLegacyEnvCompat(process.env)` at the top of `validate` in
 * `ConfigModule.forRoot`. The function mutates `env` in place so
 * subsequent reads observe the translated values.
 *
 * Removal
 * -------
 * Once all environments have been cut over to the new prefixed vars
 * and this shim is no longer needed, delete this file and its two call sites.
 */

import { SUPPORTED_NETWORKS } from "../common/constants.js";
import { createPinoExitLogger } from "../common/pino.config.js";
import type { Network } from "../common/types.js";

/**
 * Env var names (unprefixed) that were moved into a per-network namespace.
 * Each corresponds to a `<PREFIX>_<KEY>` variable in the new layout.
 *
 * Keep this list in sync with `createPerNetworkEnvSchema` in `env.schema.ts`.
 */
const LEGACY_PER_NETWORK_VARS = [
  "WALLET_ADDRESS",
  "WALLET_PRIVATE_KEY",
  "SESSION_KEY_PRIVATE_KEY",
  "RPC_URL",
  "PDP_SUBGRAPH_ENDPOINT",
  "CHECK_DATASET_CREATION_FEES",
  "USE_ONLY_APPROVED_PROVIDERS",
  "DEALBOT_DATASET_VERSION",
  "MIN_NUM_DATASETS_FOR_CHECKS",
  "DEALS_PER_SP_PER_HOUR",
  "RETRIEVALS_PER_SP_PER_HOUR",
  "DATASET_CREATIONS_PER_SP_PER_HOUR",
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
] as const;

export interface LegacyEnvCompatResult {
  /** True if legacy translation was applied. */
  applied: boolean;
  /** The network the legacy env was resolved to (only set when applied). */
  network?: Network;
  /** Legacy var names that were copied into the new prefixed slot. */
  translatedVars: string[];
  /** Reason translation was skipped, for diagnostics. */
  skipReason?: "networks_already_set" | "no_legacy_network" | "invalid_legacy_network";
}

/**
 * Translates legacy single-network env vars into the new prefixed layout.
 * Mutates `env` in place and returns a summary describing what happened.
 *
 * Rules:
 *  - If `NETWORKS` is already set, return untouched (operator has migrated).
 *  - Else if legacy `NETWORK` is set to a supported value, copy unprefixed
 *    vars into `<NETWORK>_<VAR>` slots that are currently unset. Already-set
 *    prefixed vars are never overwritten (explicit wins).
 *  - Else return untouched; downstream Joi validation will surface the
 *    missing-config error with its normal diagnostics.
 */
export function applyLegacyEnvCompat(env: NodeJS.ProcessEnv): LegacyEnvCompatResult {
  if (typeof env.NETWORKS === "string" && env.NETWORKS.trim().length > 0) {
    return { applied: false, translatedVars: [], skipReason: "networks_already_set" };
  }

  const legacyRaw = env.NETWORK;
  if (typeof legacyRaw !== "string" || legacyRaw.trim().length === 0) {
    return { applied: false, translatedVars: [], skipReason: "no_legacy_network" };
  }

  const legacyNetwork = legacyRaw.trim().toLowerCase();
  if (!SUPPORTED_NETWORKS.includes(legacyNetwork as Network)) {
    return { applied: false, translatedVars: [], skipReason: "invalid_legacy_network" };
  }

  const network = legacyNetwork as Network;
  const prefix = network.toUpperCase();
  const translatedVars: string[] = [];

  env.NETWORKS = network;

  for (const key of LEGACY_PER_NETWORK_VARS) {
    const legacyValue = env[key];
    if (typeof legacyValue !== "string" || legacyValue.length === 0) continue;

    const prefixedKey = `${prefix}_${key}`;
    const existing = env[prefixedKey];
    if (typeof existing === "string" && existing.length > 0) continue;

    env[prefixedKey] = legacyValue;
    translatedVars.push(key);
  }

  return { applied: true, network, translatedVars };
}

/**
 * One-time console warning describing a legacy translation.
 */
export function logLegacyEnvCompatResult(result: LegacyEnvCompatResult): void {
  if (!result.applied) return;

  const logger = createPinoExitLogger().child({ context: "LegacyEnvCompat" });
  logger.warn({
    level: "warn",
    event: "config_legacy_env_detected",
    message:
      "Legacy single-network env vars detected; translated into per-network prefixed vars. " +
      "Update your ConfigMap/Secrets to the prefixed names before the next release.",
    network: result.network,
    translatedVars: result.translatedVars,
  });
}
