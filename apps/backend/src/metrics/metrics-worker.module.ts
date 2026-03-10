import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DatabaseModule } from "../database/database.module.js";
import { Deal } from "../database/entities/deal.entity.js";
import { MetricsDaily } from "../database/entities/metrics-daily.entity.js";
import { Retrieval } from "../database/entities/retrieval.entity.js";
import { SpPerformanceAllTime } from "../database/entities/sp-performance-all-time.entity.js";
import { SpPerformanceLastWeek } from "../database/entities/sp-performance-last-week.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { MetricsSchedulerService } from "./services/metrics-scheduler.service.js";

/**
 * Worker-only metrics module (no HTTP controllers).
 * Provides MetricsSchedulerService for pg-boss jobs without exposing REST endpoints.
 */
@Module({
  imports: [
    DatabaseModule,
    WalletSdkModule,
    // MetricsSchedulerService needs SchedulerRegistry; ScheduleModule provides it (and registers @Cron).
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([
      SpPerformanceLastWeek,
      SpPerformanceAllTime,
      MetricsDaily,
      Deal,
      Retrieval,
      StorageProvider,
    ]),
  ],
  providers: [MetricsSchedulerService],
  exports: [MetricsSchedulerService],
})
export class MetricsWorkerModule {}
