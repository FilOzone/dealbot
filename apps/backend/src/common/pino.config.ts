import { nativeLoggerOptions } from "nestjs-pino";
import pino from "pino";

const PINO_LEVEL_MAP: Record<string, string> = {
  fatal: "fatal",
  error: "error",
  warn: "warn",
  log: "info",
  info: "info",
  debug: "debug",
  verbose: "trace",
};

export function resolvePinoLevel(level: string | undefined): string {
  if (!level) return "info";
  return PINO_LEVEL_MAP[level.toLowerCase().trim()] ?? "info";
}

export function buildLoggerModuleParams() {
  return {
    pinoHttp: {
      ...nativeLoggerOptions,
      level: resolvePinoLevel(process.env.LOG_LEVEL),
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    },
  };
}

export function createPinoExitLogger() {
  return pino({ ...buildLoggerModuleParams().pinoHttp });
}
