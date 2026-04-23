/**
 * Raw environment variable accessors.
 *
 * These are purely mechanical: they read a key from `process.env` (or any
 * `NodeJS.ProcessEnv` map) and coerce it to the requested primitive type,
 * falling back to a default when the key is absent or empty.
 */

export const getStringEnv = (env: NodeJS.ProcessEnv, key: string, fallback: string): string => env[key] || fallback;

export const getNumberEnv = (env: NodeJS.ProcessEnv, key: string, fallback: number): number => {
  const value = env[key];
  return value ? Number.parseInt(value, 10) : fallback;
};

export const getFloatEnv = (env: NodeJS.ProcessEnv, key: string, fallback: number): number => {
  const value = env[key];
  return value ? Number.parseFloat(value) : fallback;
};

export const getBooleanEnv = (env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean => {
  const value = env[key];
  return value !== undefined ? value !== "false" : fallback;
};
