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

function buildSharedPinoOptions(): pino.LoggerOptions {
  const options: pino.LoggerOptions = {
    level: resolvePinoLevel(process.env.LOG_LEVEL),
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    base: { pid: process.pid },
  };

  if ("formatters" in nativeLoggerOptions && nativeLoggerOptions.formatters) {
    options.formatters = nativeLoggerOptions.formatters;
  }

  if ("messageKey" in nativeLoggerOptions && nativeLoggerOptions.messageKey) {
    options.messageKey = nativeLoggerOptions.messageKey;
  }

  return options;
}

export function buildLoggerModuleParams() {
  return {
    pinoHttp: {
      ...nativeLoggerOptions,
      ...buildSharedPinoOptions(),
      autoLogging: false,
    },
  };
}

export function createPinoExitLogger() {
  return pino(buildSharedPinoOptions(), pino.destination({ sync: true }));
}
