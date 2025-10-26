/**
 * Metrics Module - Exports
 *
 * Provides access to metrics services and DTOs for storage provider
 * performance monitoring and analytics.
 */

// Core Services
export { MetricsRefreshService } from "./metrics-refresh.service.js";
export { MetricsQueryService } from "./metrics-query.service.js";

// Domain Services
export { DailyMetricsService } from "./services/daily-metrics.service.js";
export { FailedDealsService } from "./services/failed-deals.service.js";
export { NetworkStatsService } from "./services/network-stats.service.js";

// Controllers
export { MetricsPublicController } from "./metrics-public.controller.js";
export { DailyMetricsController } from "./controllers/daily-metrics.controller.js";
export { FailedDealsController } from "./controllers/failed-deals.controller.js";
export { NetworkStatsController } from "./controllers/network-stats.controller.js";

// Provider DTOs
export {
  ProviderWeeklyPerformanceDto,
  ProviderAllTimePerformanceDto,
  ProviderCombinedPerformanceDto,
  ProviderListResponseDto,
  NetworkStatsDto,
} from "./dto/provider-performance.dto.js";

// Daily Metrics DTOs
export {
  DailyMetricsResponseDto,
  DailyAggregatedMetricsDto,
  ProviderDailyMetricsResponseDto,
  ProviderDailyMetricsDto,
} from "./dto/daily-metrics.dto.js";

// Failed Deals DTOs
export {
  FailedDealsResponseDto,
  FailedDealDto,
  ErrorSummaryDto,
  ProviderFailureStatsDto,
  PaginationDto,
} from "./dto/failed-deals.dto.js";

// Network Stats DTOs
export {
  NetworkStatsResponseDto,
  NetworkOverallStatsDto,
  NetworkHealthDto,
  NetworkTrendsDto,
} from "./dto/network-stats.dto.js";

// Module
export { MetricsModule } from "./metrics.module.js";
