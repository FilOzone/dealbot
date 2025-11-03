import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
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
   * Optionally filter by approved and/or active providers
   */
  @Get("stats")
  @ApiOperation({
    summary: "Get complete network statistics",
    description:
      "Returns comprehensive network statistics including overall metrics, health indicators, and trends. " +
      "Optionally filter by approved and/or active providers.",
  })
  @ApiQuery({
    name: "approvedOnly",
    required: false,
    type: Boolean,
    description: "Filter to only include approved providers (is_approved = true)",
    example: true,
  })
  @ApiQuery({
    name: "activeOnly",
    required: false,
    type: Boolean,
    description: "Filter to only include active providers (is_active = true)",
    example: true,
  })
  @ApiResponse({
    status: 200,
    description: "Network statistics retrieved successfully",
    type: NetworkOverallStatsDto,
  })
  async getNetworkStats(
    @Query("approvedOnly") approvedOnly?: boolean,
    @Query("activeOnly") activeOnly?: boolean,
  ): Promise<NetworkOverallStatsDto> {
    return this.networkStatsService.getOverallStats({
      approvedOnly: approvedOnly === true || approvedOnly === "true" as any,
      activeOnly: activeOnly === true || activeOnly === "true" as any,
    });
  }
}
