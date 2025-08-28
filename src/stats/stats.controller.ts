import { Controller, Get, Logger, Query, BadRequestException } from "@nestjs/common";
import { OverallStatsService } from "./stats.service.js";
import { OverallStatsResponseDto, DailyMetricsResponseDto } from "./stats.dto.js";

@Controller("api/stats")
export class StatsController {
  private readonly logger = new Logger(StatsController.name);

  constructor(private readonly overallStatsService: OverallStatsService) {}

  /**
   * Get overall statistics for all storage providers
   */
  @Get("overall")
  async getOverallStats(): Promise<OverallStatsResponseDto> {
    this.logger.log("Fetching overall statistics");

    const overallStats = await this.overallStatsService.getOverallStats();

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
    this.logger.log(`Fetching daily metrics from ${startDateStr} to ${endDateStr}`);

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

    const dailyMetrics = await this.overallStatsService.getDailyMetrics(startDate, endDate);

    return dailyMetrics;
  }
}
