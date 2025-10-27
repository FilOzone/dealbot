import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DatabaseModule } from "../database/database.module.js";
import { Deal } from "../database/entities/deal.entity.js";
import { MetricsDaily } from "../database/entities/metrics-daily.entity.js";
import { SpPerformanceAllTime } from "../database/entities/sp-performance-all-time.entity.js";
// Entities
import { SpPerformanceWeekly } from "../database/entities/sp-performance-weekly.entity.js";
import { DailyMetricsController } from "./controllers/daily-metrics.controller.js";
import { FailedDealsController } from "./controllers/failed-deals.controller.js";
import { NetworkStatsController } from "./controllers/network-stats.controller.js";
// Controllers
import { MetricsPublicController } from "./metrics-public.controller.js";
import { MetricsQueryService } from "./metrics-query.service.js";
// Services
import { MetricsRefreshService } from "./metrics-refresh.service.js";
import { DailyMetricsService } from "./services/daily-metrics.service.js";
import { FailedDealsService } from "./services/failed-deals.service.js";
import { NetworkStatsService } from "./services/network-stats.service.js";

/**
 * Metrics Module
 *
 * Provides comprehensive metrics and analytics functionality:
 * - Provider performance tracking (materialized views)
 * - Daily time-series metrics
 * - Failed deals analysis
 * - Network-wide statistics
 *
 * Architecture:
 * - Materialized views for high-performance queries
 * - Modular services for focused functionality
 * - RESTful controllers with Swagger documentation
 */
@Module({
  imports: [DatabaseModule, TypeOrmModule.forFeature([SpPerformanceWeekly, SpPerformanceAllTime, MetricsDaily, Deal])],
  controllers: [MetricsPublicController, DailyMetricsController, FailedDealsController, NetworkStatsController],
  providers: [MetricsRefreshService, MetricsQueryService, DailyMetricsService, FailedDealsService, NetworkStatsService],
  exports: [MetricsRefreshService, MetricsQueryService, DailyMetricsService, FailedDealsService, NetworkStatsService],
})
export class MetricsModule {}
