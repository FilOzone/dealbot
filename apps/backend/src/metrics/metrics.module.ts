import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DatabaseModule } from "../database/database.module.js";
import { Deal } from "../database/entities/deal.entity.js";
import { MetricsDaily } from "../database/entities/metrics-daily.entity.js";
import { Retrieval } from "../database/entities/retrieval.entity.js";
import { SpPerformanceAllTime } from "../database/entities/sp-performance-all-time.entity.js";
import { SpPerformanceLastWeek } from "../database/entities/sp-performance-last-week.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { DailyMetricsController } from "./controllers/daily-metrics.controller.js";
import { FailedDealsController } from "./controllers/failed-deals.controller.js";
import { FailedRetrievalsController } from "./controllers/failed-retrievals.controller.js";
import { NetworkStatsController } from "./controllers/network-stats.controller.js";

import { ProvidersController } from "./controllers/providers.controller.js";
import { DailyMetricsService } from "./services/daily-metrics.service.js";
import { FailedDealsService } from "./services/failed-deals.service.js";
import { FailedRetrievalsService } from "./services/failed-retrievals.service.js";
import { MetricsSchedulerService } from "./services/metrics-scheduler.service.js";
import { NetworkStatsService } from "./services/network-stats.service.js";
import { ProvidersService } from "./services/providers.service.js";

/**
 * Metrics Module
 *
 * Provides comprehensive metrics and analytics functionality:
 * - Provider performance tracking (materialized views)
 * - Daily time-series metrics
 * - Failed deals analysis
 * - Failed retrievals analysis
 * - Network-wide statistics
 *
 * Architecture:
 * - Materialized views for high-performance queries
 * - Modular services for focused functionality
 * - RESTful controllers with Swagger documentation
 */
@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([
      SpPerformanceLastWeek,
      SpPerformanceAllTime,
      MetricsDaily,
      Deal,
      Retrieval,
      StorageProvider,
    ]),
  ],
  controllers: [
    ProvidersController,
    DailyMetricsController,
    FailedDealsController,
    FailedRetrievalsController,
    NetworkStatsController,
  ],
  providers: [
    MetricsSchedulerService,
    ProvidersService,
    DailyMetricsService,
    FailedDealsService,
    FailedRetrievalsService,
    NetworkStatsService,
  ],
  exports: [
    MetricsSchedulerService,
    ProvidersService,
    DailyMetricsService,
    FailedDealsService,
    FailedRetrievalsService,
    NetworkStatsService,
  ],
})
export class MetricsModule {}
