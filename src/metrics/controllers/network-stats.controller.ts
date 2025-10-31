import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { NetworkOverallStatsDto } from "../dto/network-stats.dto.js";
import { NetworkStatsService } from "../services/network-stats.service.js";

/**
 * Controller for network-wide statistics
 * Provides overall health, trends, and aggregate metrics
 *
 * @controller NetworkStatsController
 */
@ApiTags("Network Statistics")
@Controller("api/v1/metrics/network")
export class NetworkStatsController {
  constructor(private readonly networkStatsService: NetworkStatsService) {}

  /**
   * Get complete network statistics
   * Includes overall stats, health indicators, and trends
   */
  @Get("stats")
  @ApiOperation({
    summary: "Get complete network statistics",
    description: "Returns comprehensive network statistics including overall metrics, health indicators, and trends",
  })
  @ApiResponse({
    status: 200,
    description: "Network statistics retrieved successfully",
    type: NetworkOverallStatsDto,
  })
  async getNetworkStats(): Promise<NetworkOverallStatsDto> {
    return this.networkStatsService.getOverallStats();
  }
}
