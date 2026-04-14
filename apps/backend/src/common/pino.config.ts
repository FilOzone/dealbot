import { NativeLogger, nativeLoggerOptions, type Params, PinoLogger } from "nestjs-pino";
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

export function buildLoggerModuleParams(): Params {
  return {
    pinoHttp: {
      ...nativeLoggerOptions,
      level: resolvePinoLevel(process.env.LOG_LEVEL),
      timestamp: pino.stdTimeFunctions.isoTime,
    },
  };
}

export function createPinoExitLogger() {
  return new NativeLogger(
    new PinoLogger({
      ...buildLoggerModuleParams(),
    }),
    {},
  );
}
