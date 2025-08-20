import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DailyMetricsEntity } from "../infrastructure/database/entities/daily-metrics.entity";
import { DealEntity } from "../infrastructure/database/entities/deal.entity";
import { RetrievalEntity } from "../infrastructure/database/entities/retrieval.entity";
import { StorageProviderEntity } from "../infrastructure/database/entities/storage-provider.entity";
import { MetricsRepository } from "../infrastructure/database/repositories/metrics.repository";
import { StorageProviderRepository } from "../infrastructure/database/repositories/storage-provider.repository";
import { MetricsService } from "./metrics.service";

@Module({
  imports: [TypeOrmModule.forFeature([DailyMetricsEntity, DealEntity, RetrievalEntity, StorageProviderEntity])],
  providers: [
    MetricsRepository,
    StorageProviderRepository,
    MetricsService,
    {
      provide: "IMetricsService",
      useClass: MetricsService,
    },
    {
      provide: "IMetricsRepository",
      useClass: MetricsRepository,
    },
    {
      provide: "IStorageProviderRepository",
      useClass: StorageProviderRepository,
    },
  ],
  exports: [
    MetricsService,
    MetricsRepository,
    StorageProviderRepository,
    "IMetricsService",
    "IMetricsRepository",
    "IStorageProviderRepository",
  ],
})
export class MetricsModule {}
