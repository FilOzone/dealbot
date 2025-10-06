import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { MetricsService } from "./metrics.service.js";

@Injectable()
export class MetricsSchedulerService {
  private readonly logger = new Logger(MetricsSchedulerService.name);

  constructor(private readonly metricsService: MetricsService) {}

  /**
   * Update 7-day rolling metrics daily at 2:00 AM
   * This runs off-peak to minimize impact on production traffic
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM, {
    name: "update-7day-metrics",
    timeZone: "UTC",
  })
  async handleDaily7DayMetricsUpdate(): Promise<void> {
    this.logger.log("Starting scheduled 7-day metrics update");

    const startTime = Date.now();

    try {
      await this.metricsService.updateAll7DayMetrics();

      const duration = Date.now() - startTime;
      this.logger.log(`Scheduled 7-day metrics update completed successfully in ${duration}ms`);
    } catch (error) {
      this.logger.error(`Scheduled 7-day metrics update failed: ${error.message}`, error.stack);
    }
  }
}
