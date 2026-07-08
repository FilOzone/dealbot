/**
 * Raw environment variable accessors.
 *
 * Two layers:
 *   - `coerce*` take an already-resolved string value and coerce it to a
 *     primitive, falling back to a default when absent/empty. The per-network
 *     loader uses these because it resolves the value itself (override → shared).
 *   - `get*Env` read a single key from a `NodeJS.ProcessEnv` map and coerce it.
 *     Global (non per-network) config uses these.
 */

export const coerceNumber = (value: string | undefined, fallback: number): number =>
  value ? Number.parseInt(value, 10) : fallback;

export const coerceFloat = (value: string | undefined, fallback: number): number =>
  value ? Number.parseFloat(value) : fallback;

/**
 * Coerces a boolean env value, matching Joi's case-insensitive `true`/`false`
 * (so `"true"`, `"TRUE"`, `"false"`, `"False"` all parse to the obvious value).
 * Any other string — `"0"`, `"1"`, `"no"`, `"yes"`, etc. — is unrecognized and
 * returns the fallback rather than parsing as `false`: for a key whose default
 * is `true` (e.g. `CHECK_DATASET_CREATION_FEES`), setting `"0"`/`"no"` does NOT
 * disable it. (Joi rejects unrecognized values at boot for registered keys, so
 * the loader never sees them there.)
 */
export const coerceBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return fallback;
};

export const getStringEnv = (env: NodeJS.ProcessEnv, key: string, fallback: string): string => env[key] || fallback;

export const getNumberEnv = (env: NodeJS.ProcessEnv, key: string, fallback: number): number =>
  coerceNumber(env[key], fallback);

export const getFloatEnv = (env: NodeJS.ProcessEnv, key: string, fallback: number): number =>
  coerceFloat(env[key], fallback);

export const getBooleanEnv = (env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean =>
  coerceBoolean(env[key], fallback);
