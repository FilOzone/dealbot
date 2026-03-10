import type { LogLevel } from "@nestjs/common";

export const NEST_STARTUP_LOG_LEVELS: ReadonlyArray<LogLevel> = ["fatal", "error", "warn", "log", "debug", "verbose"];

const LOG_LEVELS: Record<string, LogLevel[]> = {
  fatal: ["fatal"],
  error: ["fatal", "error"],
  warn: ["fatal", "error", "warn"],
  log: ["fatal", "error", "warn", "log"],
  // Accept pino-style "info" input (used by filecoin-pin and synapse-sdk) and map it to Nest's "log" level.
  info: ["fatal", "error", "warn", "log"],
  debug: ["fatal", "error", "warn", "log", "debug"],
  verbose: ["fatal", "error", "warn", "log", "debug", "verbose"],
};

export function resolveLogLevels(level: string | undefined): LogLevel[] {
  if (!level) {
    return LOG_LEVELS.log;
  }
  const normalized = level.toLowerCase().trim();
  return LOG_LEVELS[normalized] ?? LOG_LEVELS.log;
}
