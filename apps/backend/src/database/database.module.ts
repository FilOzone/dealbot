import { ConsoleLogger, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { dirname, join } from "path";
import { DataSource, type DataSourceOptions } from "typeorm";
import { fileURLToPath } from "url";
import { NEST_STARTUP_LOG_LEVELS } from "../common/log-levels.js";
import { toStructuredError } from "../common/logging.js";
import type { IAppConfig, IConfig, IDatabaseConfig } from "../config/app.config.js";
import { Deal } from "./entities/deal.entity.js";
import { JobScheduleState } from "./entities/job-schedule-state.entity.js";
import { MetricsDaily } from "./entities/metrics-daily.entity.js";
import { Retrieval } from "./entities/retrieval.entity.js";
import { SpPerformanceAllTime } from "./entities/sp-performance-all-time.entity.js";
import { SpPerformanceLastWeek } from "./entities/sp-performance-last-week.entity.js";
import { StorageProvider } from "./entities/storage-provider.entity.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Keep startup diagnostics visible regardless of runtime LOG_LEVEL configuration.
const startupLogger = new ConsoleLogger("DatabaseModule", {
  json: true,
  colors: false,
  logLevels: [...NEST_STARTUP_LOG_LEVELS],
});

function toSafeDataSourceContext(options: DataSourceOptions): Record<string, unknown> {
  const sourceOptions = options as unknown as Record<string, unknown>;
  return {
    type: options.type,
    host: sourceOptions.host,
    port: sourceOptions.port,
    database: sourceOptions.database,
    username: sourceOptions.username,
    migrationsRun: sourceOptions.migrationsRun,
    synchronize: sourceOptions.synchronize,
  };
}

function resolveTypeOrmLogging(
  appEnv: string,
  logLevel: string | undefined,
): false | Array<"query" | "error" | "warn"> {
  const normalized = (logLevel ?? "").toLowerCase().trim();
  if (normalized === "debug" || normalized === "verbose") {
    return ["query", "error", "warn"];
  }
  if (appEnv === "production") {
    return ["error", "warn"];
  }
  return false;
}

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<IConfig, true>) => {
        const dbConfig = configService.get<IDatabaseConfig>("database");
        const appConfig = configService.get<IAppConfig>("app");
        const runMigrations = appConfig.env === "production" && appConfig.runMode !== "worker";
        return {
          type: "postgres",
          host: dbConfig.host,
          port: dbConfig.port,
          username: dbConfig.username,
          password: dbConfig.password,
          database: dbConfig.database,
          poolSize: dbConfig.poolMax,
          entities: [
            Deal,
            StorageProvider,
            Retrieval,
            MetricsDaily,
            SpPerformanceAllTime,
            SpPerformanceLastWeek,
            JobScheduleState,
          ],
          migrations: [join(__dirname, "migrations", "*.{js,ts}")],
          migrationsRun: runMigrations,
          migrationsTransactionMode: "each",
          synchronize: appConfig.env !== "production",
          logging: resolveTypeOrmLogging(appConfig.env, process.env.LOG_LEVEL),
        };
      },
      dataSourceFactory: async (options?: DataSourceOptions) => {
        if (!options) {
          const error = new Error("TypeORM DataSource options are undefined");
          startupLogger.fatal({
            event: "typeorm_init_failed",
            message: "Failed to initialize TypeORM data source during bootstrap",
            error: toStructuredError(error),
          });
          throw error;
        }

        try {
          return await new DataSource(options).initialize();
        } catch (error) {
          startupLogger.fatal({
            event: "typeorm_init_failed",
            message: "Failed to initialize TypeORM data source during bootstrap",
            datasource: toSafeDataSourceContext(options),
            error: toStructuredError(error),
          });
          throw error;
        }
      },
    }),
    TypeOrmModule.forFeature([Deal, StorageProvider, Retrieval, MetricsDaily, JobScheduleState]),
  ],
  providers: [Deal, StorageProvider, Retrieval, MetricsDaily, JobScheduleState],
  exports: [Deal, StorageProvider, Retrieval, MetricsDaily, JobScheduleState],
})
export class DatabaseModule {}
