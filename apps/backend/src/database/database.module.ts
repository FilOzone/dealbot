import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
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
          logging: false,
        };
      },
    }),
    TypeOrmModule.forFeature([Deal, StorageProvider, Retrieval, MetricsDaily, JobScheduleState]),
  ],
  providers: [Deal, StorageProvider, Retrieval, MetricsDaily, JobScheduleState],
  exports: [Deal, StorageProvider, Retrieval, MetricsDaily, JobScheduleState],
})
export class DatabaseModule {}
