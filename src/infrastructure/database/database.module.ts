import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { DealEntity } from "./entities/deal.entity.js";
import { StorageProviderEntity } from "./entities/storage-provider.entity.js";
import { RetrievalEntity } from "./entities/retrieval.entity.js";
import { DailyMetricsEntity } from "./entities/daily-metrics.entity.js";
import { DealRepository } from "./repositories/deal.repository.js";
import { StorageProviderRepository } from "./repositories/storage-provider.repository.js";
import { RetrievalRepository } from "./repositories/retrieval.repository.js";
import { IAppConfig } from "../../config/app.config.js";

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<IAppConfig>) => {
        const dbConfig = configService.get("database", { infer: true });
        const appConfig = configService.get("app", { infer: true });
        return {
          type: "postgres",
          host: dbConfig?.host || "localhost",
          port: dbConfig?.port || 5432,
          username: dbConfig?.username || "dealbot",
          password: dbConfig?.password || "dealbot_password",
          database: dbConfig?.database || "filecoin_dealbot",
          entities: [DealEntity, StorageProviderEntity, RetrievalEntity, DailyMetricsEntity],
          synchronize: appConfig?.env !== "production",
          // logging: appConfig?.env === "development",
          logging: false,
        };
      },
    }),
    TypeOrmModule.forFeature([DealEntity, StorageProviderEntity, RetrievalEntity, DailyMetricsEntity]),
  ],
  providers: [
    DealRepository,
    StorageProviderRepository,
    RetrievalRepository,
    {
      provide: "IDealRepository",
      useClass: DealRepository,
    },
    {
      provide: "IStorageProviderRepository",
      useClass: StorageProviderRepository,
    },
    {
      provide: "IRetrievalRepository",
      useClass: RetrievalRepository,
    },
  ],
  exports: [
    "IDealRepository",
    "IStorageProviderRepository",
    "IRetrievalRepository",
    DealRepository,
    StorageProviderRepository,
    RetrievalRepository,
  ],
})
export class DatabaseModule {}
