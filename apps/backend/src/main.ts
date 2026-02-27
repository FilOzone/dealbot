import { ConsoleLogger, type LogLevel } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cors from "cors";
import helmet from "helmet";
import { toStructuredError } from "./common/logging.js";

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

function resolveLogLevels(level: string | undefined): LogLevel[] {
  if (!level) {
    return LOG_LEVELS.log;
  }
  const normalized = level.toLowerCase().trim();
  return LOG_LEVELS[normalized] ?? LOG_LEVELS.log;
}

/** Logger used for bootstrap/exit paths before Nest app is created or on unhandled rejection. */
const exitLogger = new ConsoleLogger("Main", {
  json: true,
  colors: false,
  logLevels: resolveLogLevels(process.env.LOG_LEVEL),
});

function logErrorAndExit(event: string, message: string, error: unknown): never {
  exitLogger.error({
    event,
    message,
    error: toStructuredError(error),
  });
  process.exit(1);
}

async function bootstrap() {
  const logLevels = resolveLogLevels(process.env.LOG_LEVEL);
  const logger = new ConsoleLogger("Main", {
    json: true,
    colors: false,
    logLevels,
  });

  const runMode = (process.env.DEALBOT_RUN_MODE || "both").toLowerCase();
  const isWorkerOnly = runMode === "worker";
  const rootModule = isWorkerOnly
    ? (await import("./worker.module.js")).WorkerModule
    : (await import("./app.module.js")).AppModule;
  const app = await NestFactory.create(rootModule, {
    logger,
  });

  // Ensure Nest calls lifecycle shutdown hooks (OnApplicationShutdown / BeforeApplicationShutdown)
  // so resources (DB pools, schedulers, etc.) can be released on SIGINT/SIGTERM.
  app.enableShutdownHooks();

  if (!isWorkerOnly) {
    app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: [`'self'`],
            styleSrc: [`'self'`, `'unsafe-inline'`],
            imgSrc: [`'self'`, "data:", "validator.swagger.io"],
            scriptSrc: [`'self'`, `https: 'unsafe-inline'`],
            connectSrc: [`'self'`, `https:`],
          },
        },
      }),
    );

    // Configure CORS using express cors middleware directly
    const allowedOrigins = (process.env.DEALBOT_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);

    app.use(
      cors({
        credentials: true,
        origin: allowedOrigins.length > 0 ? allowedOrigins : false, // Disable CORS if no origins configured
      }),
    );

    const config = new DocumentBuilder()
      .setTitle("Dealbot")
      .setDescription("FWSS Dealbot API methods")
      .setVersion("1.0")
      .addTag("dealbot")
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api", app, document);
  }

  const portEnvValue = isWorkerOnly ? process.env.DEALBOT_METRICS_PORT : process.env.DEALBOT_PORT;
  const port = Number.parseInt(isWorkerOnly ? portEnvValue || "9090" : portEnvValue || "3000", 10);
  if (Number.isNaN(port)) {
    const name = isWorkerOnly ? "DEALBOT_METRICS_PORT" : "DEALBOT_PORT";
    throw new Error(`Invalid ${name}: ${portEnvValue ?? ""}`);
  }
  const host = isWorkerOnly ? process.env.DEALBOT_METRICS_HOST || "0.0.0.0" : process.env.DEALBOT_HOST || "127.0.0.1";
  await app.listen(port, host);
  logger.log(
    isWorkerOnly
      ? `Dealbot worker is running; metrics available on ${host}:${port}/metrics`
      : `Dealbot backend is running on ${host}:${port}`,
  );
}

void bootstrap().catch((error: unknown) =>
  logErrorAndExit("bootstrap_failed", "Bootstrap failed", error),
);

process.on("unhandledRejection", (reason: unknown, _promise: Promise<unknown>) => {
  logErrorAndExit("unhandled_rejection", "Unhandled rejection", reason);
});
