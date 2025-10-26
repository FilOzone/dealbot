import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Deal } from "./entities/deal.entity.js";
import { StorageProvider } from "./entities/storage-provider.entity.js";
import { Retrieval } from "./entities/retrieval.entity.js";
import { MetricsDaily } from "./entities/metrics-daily.entity.js";
import { SpPerformanceAllTime } from "./entities/sp-performance-all-time.entity.js";
import { SpPerformanceWeekly } from "./entities/sp-performance-weekly.entity.js";
import { IAppConfig, IConfig, IDatabaseConfig } from "../config/app.config.js";

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
        return {
          type: "postgres",
          host: dbConfig.host,
          port: dbConfig.port,
          username: dbConfig.username,
          password: dbConfig.password,
          database: dbConfig.database,
          entities: [Deal, StorageProvider, Retrieval, MetricsDaily, SpPerformanceAllTime, SpPerformanceWeekly],
          migrations: [join(__dirname, "migrations", "*.{js,ts}")],
          migrationsRun: true,
          synchronize: appConfig.env !== "production",
          logging: false,
        };
      },
    }),
    TypeOrmModule.forFeature([Deal, StorageProvider, Retrieval, MetricsDaily]),
  ],
  providers: [Deal, StorageProvider, Retrieval, MetricsDaily],
  exports: [Deal, StorageProvider, Retrieval, MetricsDaily],
})
export class DatabaseModule {}
