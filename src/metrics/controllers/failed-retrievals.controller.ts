import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ServiceType } from "../../database/types.js";
import { FailedRetrievalsResponseDto } from "../dto/failed-retrievals.dto.js";
import { FailedRetrievalsService } from "../services/failed-retrievals.service.js";

/**
 * Controller for failed retrievals endpoints
 * Provides error tracking, debugging, and failure analysis for retrievals
 *
 * @controller FailedRetrievalsController
 */
@ApiTags("Failed Retrievals")
@Controller("api/v1/metrics/failed-retrievals")
export class FailedRetrievalsController {
  constructor(private readonly failedRetrievalsService: FailedRetrievalsService) {}

  /**
   * Get failed retrievals with pagination and filtering
   * Supports search, provider filter, and service type filter
   */
  @Get()
  @ApiOperation({
    summary: "Get failed retrievals",
    description: "Returns paginated list of failed retrievals with comprehensive filtering and search capabilities",
  })
  @ApiQuery({
    name: "startDate",
    required: false,
    description: "Start date in YYYY-MM-DD format (default: 7 days ago)",
    example: "2024-01-01",
  })
  @ApiQuery({
    name: "endDate",
    required: false,
    description: "End date in YYYY-MM-DD format (default: today)",
    example: "2024-01-07",
  })
  @ApiQuery({
    name: "page",
    required: false,
    description: "Page number (default: 1)",
    example: 1,
  })
  @ApiQuery({
    name: "limit",
    required: false,
    description: "Items per page (default: 20, max: 100)",
    example: 20,
  })
  @ApiQuery({
    name: "search",
    required: false,
    description: "Search term (searches in retrieval endpoint and error message)",
    example: "timeout",
  })
  @ApiQuery({
    name: "provider",
    required: false,
    description: "Filter by storage provider address",
    example: "0x1234567890abcdef",
  })
  @ApiQuery({
    name: "serviceType",
    required: false,
    description: "Filter by service type (cdn, direct_sp, ipfs_pin)",
    example: "cdn",
  })
  @ApiResponse({
    status: 200,
    description: "Failed retrievals retrieved successfully",
    type: FailedRetrievalsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: "Invalid parameters",
  })
  async getFailedRetrievals(
    @Query("startDate") startDateStr?: string,
    @Query("endDate") endDateStr?: string,
    @Query("page") pageStr?: string,
    @Query("limit") limitStr?: string,
    @Query("search") search?: string,
    @Query("provider") provider?: string,
    @Query("serviceType") serviceType?: ServiceType,
  ): Promise<FailedRetrievalsResponseDto> {
    // Default to last 7 days if no dates provided
    const endDate = endDateStr ? this.parseDate(endDateStr) : new Date();
    const startDate = startDateStr ? this.parseDate(startDateStr) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const page = pageStr ? Number.parseInt(pageStr, 10) : 1;
    const limit = limitStr ? Number.parseInt(limitStr, 10) : 20;

    return this.failedRetrievalsService.getFailedRetrievals(
      startDate,
      endDate,
      page,
      limit,
      search,
      provider,
      serviceType,
    );
  }

  /**
   * Get error summary statistics
   * Returns most common errors and failures by service type/provider
   */
  @Get("summary")
  @ApiOperation({
    summary: "Get error summary",
    description:
      "Returns summary statistics including most common errors, failures by service type, and failures by provider",
  })
  @ApiQuery({
    name: "startDate",
    required: false,
    description: "Start date in YYYY-MM-DD format (default: 7 days ago)",
    example: "2024-01-01",
  })
  @ApiQuery({
    name: "endDate",
    required: false,
    description: "End date in YYYY-MM-DD format (default: today)",
    example: "2024-01-07",
  })
  @ApiResponse({
    status: 200,
    description: "Error summary retrieved successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Invalid date format",
  })
  async getErrorSummary(@Query("startDate") startDateStr?: string, @Query("endDate") endDateStr?: string) {
    const endDate = endDateStr ? this.parseDate(endDateStr) : new Date();
    const startDate = startDateStr ? this.parseDate(startDateStr) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    return this.failedRetrievalsService.getErrorSummary(startDate, endDate);
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
