import { Controller, Get, Query, BadRequestException } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from "@nestjs/swagger";
import { FailedDealsService } from "../services/failed-deals.service.js";
import { FailedDealsResponseDto } from "../dto/failed-deals.dto.js";

/**
 * Controller for failed deals endpoints
 * Provides error tracking, debugging, and failure analysis
 *
 * @controller FailedDealsController
 */
@ApiTags("Failed Deals")
@Controller("api/v1/metrics/failed-deals")
export class FailedDealsController {
  constructor(private readonly failedDealsService: FailedDealsService) {}

  /**
   * Get failed deals with pagination and filtering
   * Supports search, provider filter, and error code filter
   */
  @Get()
  @ApiOperation({
    summary: "Get failed deals",
    description:
      "Returns paginated list of failed deals with comprehensive filtering and search capabilities",
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
    description: "Search term (searches in filename, CID, and error message)",
    example: "timeout",
  })
  @ApiQuery({
    name: "provider",
    required: false,
    description: "Filter by storage provider address",
    example: "0x1234567890abcdef",
  })
  @ApiQuery({
    name: "errorCode",
    required: false,
    description: "Filter by error code",
    example: "TIMEOUT",
  })
  @ApiResponse({
    status: 200,
    description: "Failed deals retrieved successfully",
    type: FailedDealsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: "Invalid parameters",
  })
  async getFailedDeals(
    @Query("startDate") startDateStr?: string,
    @Query("endDate") endDateStr?: string,
    @Query("page") pageStr?: string,
    @Query("limit") limitStr?: string,
    @Query("search") search?: string,
    @Query("provider") provider?: string,
    @Query("errorCode") errorCode?: string,
  ): Promise<FailedDealsResponseDto> {
    // Default to last 7 days if no dates provided
    const endDate = endDateStr ? this.parseDate(endDateStr) : new Date();
    const startDate = startDateStr
      ? this.parseDate(startDateStr)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const page = pageStr ? parseInt(pageStr, 10) : 1;
    const limit = limitStr ? parseInt(limitStr, 10) : 20;

    return this.failedDealsService.getFailedDeals(
      startDate,
      endDate,
      page,
      limit,
      search,
      provider,
      errorCode,
    );
  }

  /**
   * Get error summary statistics
   * Returns most common errors and failures by provider
   */
  @Get("summary")
  @ApiOperation({
    summary: "Get error summary",
    description: "Returns summary statistics including most common errors and failures by provider",
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
  async getErrorSummary(
    @Query("startDate") startDateStr?: string,
    @Query("endDate") endDateStr?: string,
  ) {
    const endDate = endDateStr ? this.parseDate(endDateStr) : new Date();
    const startDate = startDateStr
      ? this.parseDate(startDateStr)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    return this.failedDealsService.getErrorSummary(startDate, endDate);
  }

  /**
   * Parse date string to Date object
   *
   * @private
   */
  private parseDate(dateStr: string): Date {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      throw new BadRequestException(`Invalid date format: ${dateStr}. Use YYYY-MM-DD format.`);
    }
    return date;
  }
}
