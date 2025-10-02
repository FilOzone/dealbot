import { Controller, Get, Query, BadRequestException } from "@nestjs/common";
import { StatsService } from "./stats.service.js";
import { OverallStatsResponseDto, DailyMetricsResponseDto, FailedDealsResponseDto } from "./stats.dto.js";

@Controller("api/stats")
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  /**
   * Get overall statistics for all storage providers
   */
  @Get("overall")
  async getOverallStats(): Promise<OverallStatsResponseDto> {
    const overallStats = await this.statsService.getOverallStats();

    return {
      overallStats,
    };
  }

  /**
   * Get daily metrics for a specified date range
   * Returns both aggregated and per-provider metrics in a single response
   * Perfect for recharts visualization comparing deals vs retrievals with/without CDN
   */
  @Get("daily")
  async getDailyMetrics(
    @Query("startDate") startDateStr?: string,
    @Query("endDate") endDateStr?: string,
  ): Promise<DailyMetricsResponseDto> {
    // Default to last 30 days if no dates provided
    const endDate = endDateStr ? new Date(endDateStr) : new Date();
    const startDate = startDateStr ? new Date(startDateStr) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Validate dates
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new BadRequestException("Invalid date format. Use YYYY-MM-DD format.");
    }

    if (startDate > endDate) {
      throw new BadRequestException("Start date must be before or equal to end date.");
    }

    // Limit to maximum 90 days to prevent performance issues
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff > 90) {
      throw new BadRequestException("Date range cannot exceed 90 days.");
    }

    const dailyMetrics = await this.statsService.getDailyMetrics(startDate, endDate);

    return dailyMetrics;
  }

  /**
   * Get failed deals for a specified date range with error details
   * Returns recent failed deals to help storage providers identify and resolve issues
   * Supports pagination, search, and filtering
   */
  @Get("failed-deals")
  async getFailedDeals(
    @Query("startDate") startDateStr?: string,
    @Query("endDate") endDateStr?: string,
    @Query("page") pageStr?: string,
    @Query("limit") limitStr?: string,
    @Query("search") search?: string,
    @Query("provider") provider?: string,
    @Query("withCDN") withCDNStr?: string,
    @Query("errorCode") errorCode?: string,
  ): Promise<FailedDealsResponseDto> {
    // Default to last 7 days if no dates provided
    const endDate = endDateStr ? new Date(endDateStr) : new Date();
    const startDate = startDateStr ? new Date(startDateStr) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const page = pageStr ? parseInt(pageStr, 10) : 1;
    const limit = limitStr ? parseInt(limitStr, 10) : 20;
    const withCDN = withCDNStr === "true" ? true : withCDNStr === "false" ? false : undefined;

    // Validate dates
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new BadRequestException("Invalid date format. Use YYYY-MM-DD format.");
    }

    if (startDate > endDate) {
      throw new BadRequestException("Start date must be before or equal to end date.");
    }

    // Validate pagination
    if (isNaN(page) || page < 1) {
      throw new BadRequestException("Page must be a positive number.");
    }
    if (isNaN(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException("Limit must be a number between 1 and 100.");
    }

    // Limit to maximum 30 days to prevent performance issues
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff > 30) {
      throw new BadRequestException("Date range cannot exceed 30 days.");
    }

    const failedDeals = await this.statsService.getFailedDeals(
      startDate,
      endDate,
      page,
      limit,
      search,
      provider,
      withCDN,
      errorCode,
    );

    return failedDeals;
  }
}
