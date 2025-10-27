import { BadRequestException, Controller, Get, Param, Query } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { DailyMetricsResponseDto, ProviderDailyMetricsResponseDto } from "../dto/daily-metrics.dto.js";
import type { DailyMetricsService } from "../services/daily-metrics.service.js";

/**
 * Controller for daily metrics endpoints
 * Provides time-series data for visualization and analysis
 *
 * @controller DailyMetricsController
 */
@ApiTags("Daily Metrics")
@Controller("api/v1/metrics/daily")
export class DailyMetricsController {
  constructor(private readonly dailyMetricsService: DailyMetricsService) {}

  /**
   * Get network-wide daily metrics for a date range
   * Aggregates metrics across all providers by date
   */
  @Get()
  @ApiOperation({
    summary: "Get daily metrics",
    description: "Returns aggregated daily metrics for the entire network within a specified date range",
  })
  @ApiQuery({
    name: "startDate",
    required: false,
    description: "Start date in YYYY-MM-DD format (default: 30 days ago)",
    example: "2024-01-01",
  })
  @ApiQuery({
    name: "endDate",
    required: false,
    description: "End date in YYYY-MM-DD format (default: today)",
    example: "2024-01-31",
  })
  @ApiResponse({
    status: 200,
    description: "Daily metrics retrieved successfully",
    type: DailyMetricsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: "Invalid date format or date range exceeds maximum",
  })
  async getDailyMetrics(
    @Query("startDate") startDateStr?: string,
    @Query("endDate") endDateStr?: string,
  ): Promise<DailyMetricsResponseDto> {
    // Default to last 30 days if no dates provided
    const endDate = endDateStr ? this.parseDate(endDateStr) : new Date();
    const startDate = startDateStr ? this.parseDate(startDateStr) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    return this.dailyMetricsService.getDailyMetrics(startDate, endDate);
  }

  /**
   * Get recent daily metrics (convenience endpoint)
   * Returns metrics for the last N days
   */
  @Get("recent")
  @ApiOperation({
    summary: "Get recent daily metrics",
    description: "Returns daily metrics for the last N days (convenience endpoint)",
  })
  @ApiQuery({
    name: "days",
    required: false,
    description: "Number of days to fetch (default: 30, max: 90)",
    example: 30,
  })
  @ApiResponse({
    status: 200,
    description: "Recent daily metrics retrieved successfully",
    type: DailyMetricsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: "Invalid days parameter",
  })
  async getRecentDailyMetrics(@Query("days") daysStr?: string): Promise<DailyMetricsResponseDto> {
    const days = daysStr ? Number.parseInt(daysStr, 10) : 30;

    if (Number.isNaN(days) || days < 1 || days > 90) {
      throw new BadRequestException("Days must be a number between 1 and 90");
    }

    return this.dailyMetricsService.getRecentDailyMetrics(days);
  }

  /**
   * Get daily metrics for a specific provider
   * Returns provider-specific time-series data
   */
  @Get("providers/:address")
  @ApiOperation({
    summary: "Get provider daily metrics",
    description: "Returns daily metrics for a specific storage provider within a date range",
  })
  @ApiParam({
    name: "address",
    description: "Storage provider address",
    example: "0x1234567890abcdef",
  })
  @ApiQuery({
    name: "startDate",
    required: false,
    description: "Start date in YYYY-MM-DD format (default: 30 days ago)",
    example: "2024-01-01",
  })
  @ApiQuery({
    name: "endDate",
    required: false,
    description: "End date in YYYY-MM-DD format (default: today)",
    example: "2024-01-31",
  })
  @ApiResponse({
    status: 200,
    description: "Provider daily metrics retrieved successfully",
    type: ProviderDailyMetricsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: "Invalid date format or date range exceeds maximum",
  })
  async getProviderDailyMetrics(
    @Param("address") spAddress: string,
    @Query("startDate") startDateStr?: string,
    @Query("endDate") endDateStr?: string,
  ): Promise<ProviderDailyMetricsResponseDto> {
    // Default to last 30 days if no dates provided
    const endDate = endDateStr ? this.parseDate(endDateStr) : new Date();
    const startDate = startDateStr ? this.parseDate(startDateStr) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    return this.dailyMetricsService.getProviderDailyMetrics(spAddress, startDate, endDate);
  }

  /**
   * Parse date string to Date object
   *
   * @private
   */
  private parseDate(dateStr: string): Date {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`Invalid date format: ${dateStr}. Use YYYY-MM-DD format.`);
    }
    return date;
  }
}
