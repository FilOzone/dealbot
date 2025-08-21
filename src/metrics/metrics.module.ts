import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DailyMetricsEntity } from "../infrastructure/database/entities/daily-metrics.entity.js";
import { DealEntity } from "../infrastructure/database/entities/deal.entity.js";
import { RetrievalEntity } from "../infrastructure/database/entities/retrieval.entity.js";
import { StorageProviderEntity } from "../infrastructure/database/entities/storage-provider.entity.js";
import { MetricsRepository } from "../infrastructure/database/repositories/metrics.repository.js";
import { StorageProviderRepository } from "../infrastructure/database/repositories/storage-provider.repository.js";
import { MetricsService } from "./metrics.service.js";

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
