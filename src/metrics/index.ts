/**
 * Metrics Module - Exports
 *
 * Provides access to metrics services and DTOs for storage provider
 * performance monitoring and analytics.
 */

export { DailyMetricsController } from "./controllers/daily-metrics.controller.js";
export { FailedDealsController } from "./controllers/failed-deals.controller.js";
export { NetworkStatsController } from "./controllers/network-stats.controller.js";
// Daily Metrics DTOs
export {
  DailyAggregatedMetricsDto,
  DailyMetricsResponseDto,
  ProviderDailyMetricsDto,
  ProviderDailyMetricsResponseDto,
} from "./dto/daily-metrics.dto.js";
// Failed Deals DTOs
export {
  ErrorSummaryDto,
  FailedDealDto,
  FailedDealsResponseDto,
  PaginationDto,
  ProviderFailureStatsDto,
} from "./dto/failed-deals.dto.js";
// Network Stats DTOs
export {
  NetworkHealthDto,
  NetworkOverallStatsDto,
  NetworkStatsResponseDto,
  NetworkTrendsDto,
} from "./dto/network-stats.dto.js";
// Provider DTOs
export {
  NetworkStatsDto,
  ProviderAllTimePerformanceDto,
  ProviderCombinedPerformanceDto,
  ProviderListResponseDto,
  ProviderWeeklyPerformanceDto,
} from "./dto/provider-performance.dto.js";
// Module
export { MetricsModule } from "./metrics.module.js";
// Controllers
export { MetricsPublicController } from "./metrics-public.controller.js";
export { MetricsQueryService } from "./metrics-query.service.js";
// Core Services
export { MetricsRefreshService } from "./metrics-refresh.service.js";
// Domain Services
export { DailyMetricsService } from "./services/daily-metrics.service.js";
export { FailedDealsService } from "./services/failed-deals.service.js";
export { NetworkStatsService } from "./services/network-stats.service.js";
