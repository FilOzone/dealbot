import { Controller, Get, Logger } from "@nestjs/common";
import { OverallStatsService } from "./stats.service";
import { OverallStatsResponseDto } from "./stats.dto";

@Controller("/api/stats")
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
}
