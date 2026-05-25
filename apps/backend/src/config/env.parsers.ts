/**
 * Domain-level environment parsers.
 *
 * Each function here takes a raw `NodeJS.ProcessEnv` map and produces a
 * well-typed domain value.
 */

import { SUPPORTED_NETWORKS } from "../common/constants.js";
import type { Network } from "../common/types.js";
import { getStringEnv } from "./env.helpers.js";
import type { IAppConfig } from "./types.js";

/**
 * Returns the list of active networks derived from the `NETWORKS` env var.
 * Falls back to the first supported network when the variable is absent.
 */
export function parseActiveNetworks(env: NodeJS.ProcessEnv): Network[] {
  const raw = getStringEnv(env, "NETWORKS", SUPPORTED_NETWORKS[0]);
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Network => SUPPORTED_NETWORKS.includes(s as Network));
}

/**
 * Parses the `DEALBOT_RUN_MODE` env var into a typed run-mode string.
 * Defaults to `"both"` when absent or unrecognised.
 */
export function parseRunMode(env: NodeJS.ProcessEnv): IAppConfig["runMode"] {
  const mode = getStringEnv(env, "DEALBOT_RUN_MODE", "both").toLowerCase();
  if (mode === "worker") return "worker";
  if (mode === "api") return "api";
  return "both";
}

/**
 * Parses the comma-separated `RANDOM_PIECE_SIZES` env var into an array of
 * byte-lengths.  Defaults to 10 MiB when absent or unparseable.
 */
export function parseRandomDatasetSizes(env: NodeJS.ProcessEnv): number[] {
  const envValue = env.RANDOM_PIECE_SIZES;

  if (envValue && envValue.trim().length > 0) {
    const parsed = envValue
      .split(",")
      .map((entry) => Number.parseInt(entry.trim(), 10))
      .filter((entry) => Number.isFinite(entry) && !Number.isNaN(entry));

    if (parsed.length > 0) {
      return parsed;
    }
  }

  return [10 << 20];
}

export function parseIdList(value: string | undefined): Set<string> {
  if (!value || value.trim().length === 0) return new Set();
  return new Set(
    value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

export function parseAddressList(value: string | undefined): Set<string> {
  if (!value || value.trim().length === 0) return new Set();
  return new Set(
    value
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
}
