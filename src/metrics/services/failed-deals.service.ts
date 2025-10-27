import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Between, IsNull, Like, Not, type Repository } from "typeorm";
import { Deal } from "../../database/entities/deal.entity.js";
import { DealStatus } from "../../database/types.js";
import type {
  ErrorSummaryDto,
  FailedDealDto,
  FailedDealsResponseDto,
  PaginationDto,
  ProviderFailureStatsDto,
} from "../dto/failed-deals.dto.js";

/**
 * Service for handling failed deals queries and analysis
 * Provides error tracking, debugging, and failure pattern identification
 *
 * @class FailedDealsService
 */
@Injectable()
export class FailedDealsService {
  private readonly logger = new Logger(FailedDealsService.name);

  constructor(
    @InjectRepository(Deal)
    private readonly dealRepo: Repository<Deal>,
  ) {}

  /**
   * Get failed deals with pagination and filtering
   *
   * @param startDate - Start date for the query
   * @param endDate - End date for the query
   * @param page - Page number (1-indexed)
   * @param limit - Items per page
   * @param search - Optional search term (filename, CID, error message)
   * @param provider - Optional provider filter
   * @param errorCode - Optional error code filter
   * @returns Paginated failed deals with summary
   */
  async getFailedDeals(
    startDate: Date,
    endDate: Date,
    page: number = 1,
    limit: number = 20,
    search?: string,
    provider?: string,
    errorCode?: string,
  ): Promise<FailedDealsResponseDto> {
    try {
      this.validateDateRange(startDate, endDate, 30);
      this.validatePagination(page, limit);

      // Build where clause
      const baseWhere: any = {
        createdAt: Between(startDate, endDate),
        status: DealStatus.FAILED,
        errorMessage: Not(IsNull()),
      };

      if (provider) {
        baseWhere.spAddress = provider;
      }

      if (errorCode) {
        baseWhere.errorCode = errorCode;
      }

      // Handle search across multiple fields
      let whereClause: any;
      if (search) {
        const searchPattern = `%${search}%`;
        whereClause = [
          { ...baseWhere, fileName: Like(searchPattern) },
          { ...baseWhere, pieceCid: Like(searchPattern) },
          { ...baseWhere, errorMessage: Like(searchPattern) },
        ];
      } else {
        whereClause = baseWhere;
      }

      // Execute query with pagination
      const [failedDeals, total] = await this.dealRepo.findAndCount({
        where: whereClause,
        order: {
          createdAt: "DESC",
        },
        skip: (page - 1) * limit,
        take: limit,
      });

      // Map to DTOs
      const failedDealDtos = this.mapToFailedDealDtos(failedDeals);

      // Calculate summary
      const summary = await this.calculateSummary(startDate, endDate, provider, errorCode);

      // Build pagination metadata
      const pagination = this.buildPaginationDto(page, limit, total);

      return {
        failedDeals: failedDealDtos,
        pagination,
        dateRange: {
          startDate: startDate.toISOString().split("T")[0],
          endDate: endDate.toISOString().split("T")[0],
        },
        summary,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch failed deals: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get error summary statistics
   *
   * @param startDate - Start date for the query
   * @param endDate - End date for the query
   * @returns Error summary with most common errors and failures by provider
   */
  async getErrorSummary(startDate: Date, endDate: Date) {
    try {
      this.validateDateRange(startDate, endDate, 30);

      return await this.calculateSummary(startDate, endDate);
    } catch (error) {
      this.logger.error(`Failed to fetch error summary: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Map Deal entities to FailedDealDto
   *
   * @private
   */
  private mapToFailedDealDtos(deals: Deal[]): FailedDealDto[] {
    return deals.map((deal) => ({
      id: deal.id,
      fileName: deal.fileName,
      fileSize: Number(deal.fileSize),
      dataSetId: deal.dataSetId,
      pieceCid: deal.pieceCid || undefined,
      spAddress: deal.spAddress,
      status: deal.status,
      errorMessage: deal.errorMessage || "",
      errorCode: deal.errorCode || undefined,
      retryCount: deal.retryCount,
      createdAt: deal.createdAt,
      updatedAt: deal.updatedAt,
      uploadStartTime: deal.uploadStartTime || undefined,
      uploadEndTime: deal.uploadEndTime || undefined,
      pieceAddedTime: deal.pieceAddedTime || undefined,
      dealConfirmedTime: deal.dealConfirmedTime || undefined,
    }));
  }

  /**
   * Calculate summary statistics for failed deals
   *
   * @private
   */
  private async calculateSummary(startDate: Date, endDate: Date, provider?: string, errorCode?: string) {
    const baseWhere: any = {
      createdAt: Between(startDate, endDate),
      status: DealStatus.FAILED,
      errorMessage: Not(IsNull()),
    };

    if (provider) {
      baseWhere.spAddress = provider;
    }

    if (errorCode) {
      baseWhere.errorCode = errorCode;
    }

    // Get all failed deals for summary calculation
    const failedDeals = await this.dealRepo.find({
      where: baseWhere,
      select: ["spAddress", "errorCode", "errorMessage"],
    });

    const totalFailedDeals = failedDeals.length;
    const uniqueProviders = new Set(failedDeals.map((d) => d.spAddress)).size;

    // Calculate most common errors
    const errorCounts = new Map<string, { errorMessage: string; count: number }>();
    failedDeals.forEach((deal) => {
      const key = `${deal.errorCode || "UNKNOWN"}:${deal.errorMessage}`;
      if (errorCounts.has(key)) {
        errorCounts.get(key)!.count++;
      } else {
        errorCounts.set(key, {
          errorMessage: deal.errorMessage || "Unknown error",
          count: 1,
        });
      }
    });

    const mostCommonErrors: ErrorSummaryDto[] = Array.from(errorCounts.entries())
      .map(([key, value]) => ({
        errorCode: key.split(":")[0],
        errorMessage: value.errorMessage,
        count: value.count,
        percentage: totalFailedDeals > 0 ? Math.round((value.count / totalFailedDeals) * 100 * 100) / 100 : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Calculate failures by provider
    const providerFailures = new Map<string, { count: number; errors: string[] }>();
    failedDeals.forEach((deal) => {
      if (providerFailures.has(deal.spAddress)) {
        const existing = providerFailures.get(deal.spAddress)!;
        existing.count++;
        existing.errors.push(deal.errorMessage || "Unknown error");
      } else {
        providerFailures.set(deal.spAddress, {
          count: 1,
          errors: [deal.errorMessage || "Unknown error"],
        });
      }
    });

    const failuresByProvider: ProviderFailureStatsDto[] = Array.from(providerFailures.entries())
      .map(([spAddress, data]) => {
        // Find most common error for this provider
        const errorCounts = new Map<string, number>();
        data.errors.forEach((error) => {
          errorCounts.set(error, (errorCounts.get(error) || 0) + 1);
        });
        const mostCommonError =
          Array.from(errorCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "Unknown error";

        return {
          spAddress,
          failedDeals: data.count,
          percentage: totalFailedDeals > 0 ? Math.round((data.count / totalFailedDeals) * 100 * 100) / 100 : 0,
          mostCommonError,
        };
      })
      .sort((a, b) => b.failedDeals - a.failedDeals)
      .slice(0, 10);

    return {
      totalFailedDeals,
      uniqueProviders,
      mostCommonErrors,
      failuresByProvider,
    };
  }

  /**
   * Build pagination DTO
   *
   * @private
   */
  private buildPaginationDto(page: number, limit: number, total: number): PaginationDto {
    const totalPages = Math.ceil(total / limit);

    return {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  }

  /**
   * Validate date range
   *
   * @private
   */
  private validateDateRange(startDate: Date, endDate: Date, maxDays: number): void {
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new BadRequestException("Invalid date format. Use ISO 8601 format (YYYY-MM-DD).");
    }

    if (startDate > endDate) {
      throw new BadRequestException("Start date must be before or equal to end date.");
    }

    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff > maxDays) {
      throw new BadRequestException(`Date range cannot exceed ${maxDays} days.`);
    }
  }

  /**
   * Validate pagination parameters
   *
   * @private
   */
  private validatePagination(page: number, limit: number): void {
    if (Number.isNaN(page) || page < 1) {
      throw new BadRequestException("Page must be a positive number.");
    }

    if (Number.isNaN(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException("Limit must be a number between 1 and 100.");
    }
  }
}
