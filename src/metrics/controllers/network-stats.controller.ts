import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { NetworkStatsService } from "../services/network-stats.service.js";
import {
  NetworkStatsResponseDto,
  NetworkOverallStatsDto,
  NetworkHealthDto,
  NetworkTrendsDto,
} from "../dto/network-stats.dto.js";

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
    type: NetworkStatsResponseDto,
  })
  async getNetworkStats(): Promise<NetworkStatsResponseDto> {
    return this.networkStatsService.getNetworkStats();
  }

  /**
   * Get overall network statistics only
   * Returns aggregated metrics without health and trends
   */
  @Get("overall")
  @ApiOperation({
    summary: "Get overall network statistics",
    description: "Returns aggregated network metrics across all providers",
  })
  @ApiResponse({
    status: 200,
    description: "Overall statistics retrieved successfully",
    type: NetworkOverallStatsDto,
  })
  async getOverallStats(): Promise<NetworkOverallStatsDto> {
    return this.networkStatsService.getOverallStats();
  }

  /**
   * Get network health indicators only
   * Returns health scores and reliability metrics
   */
  @Get("health")
  @ApiOperation({
    summary: "Get network health indicators",
    description: "Returns health scores including deal reliability, retrieval reliability, and performance metrics",
  })
  @ApiResponse({
    status: 200,
    description: "Health indicators retrieved successfully",
    type: NetworkHealthDto,
  })
  async getHealthIndicators(): Promise<NetworkHealthDto> {
    return this.networkStatsService.getHealthIndicators();
  }

  /**
   * Get network activity trends
   * Returns trend data comparing recent activity to previous periods
   */
  @Get("trends")
  @ApiOperation({
    summary: "Get network activity trends",
    description: "Returns activity trends comparing last 7 days to previous periods",
  })
  @ApiResponse({
    status: 200,
    description: "Trends retrieved successfully",
    type: NetworkTrendsDto,
  })
  async getTrends(): Promise<NetworkTrendsDto> {
    return this.networkStatsService.getTrends();
  }
}
