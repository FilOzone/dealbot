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
import { IAppConfig, IConfig, IDatabaseConfig } from "../../config/app.config.js";

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
          entities: [DealEntity, StorageProviderEntity, RetrievalEntity, DailyMetricsEntity],
          synchronize: appConfig.env !== "production",
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
