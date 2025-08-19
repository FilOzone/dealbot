import { Controller, Get, Query, HttpStatus, HttpException, Logger } from "@nestjs/common";
import { DealService } from "./deal.service";

@Controller("deals")
export class DealController {
  private readonly logger = new Logger(DealController.name);

  constructor(private readonly dealService: DealService) {}

  @Get("metrics")
  async getMetrics(@Query("startDate") startDate?: string, @Query("endDate") endDate?: string) {
    try {
      const start = startDate ? new Date(startDate) : new Date(Date.now() - 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate) : new Date();

      const metrics = await this.dealService.getMetrics(start, end);

      return {
        success: true,
        data: {
          period: { start, end },
          metrics,
        },
      };
    } catch (error) {
      this.logger.error("Failed to get metrics", error);
      throw new HttpException(
        {
          success: false,
          message: error.message || "Failed to retrieve metrics",
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("health")
  async checkHealth() {
    return {
      success: true,
      status: "healthy",
      timestamp: new Date().toISOString(),
      service: "deal-service",
    };
  }
}
