import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { Retrieval } from "../../database/entities/retrieval.entity.js";
import { RetrievalStatus, ServiceType } from "../../database/types.js";
import type {
  FailedRetrievalDto,
  FailedRetrievalsResponseDto,
  PaginationDto,
  ProviderRetrievalFailureStatsDto,
  RetrievalErrorSummaryDto,
  ServiceTypeFailureStatsDto,
} from "../dto/failed-retrievals.dto.js";

/**
 * Service for handling failed retrievals queries and analysis
 * Provides error tracking, debugging, and failure pattern identification
 *
 * @class FailedRetrievalsService
 */
@Injectable()
export class FailedRetrievalsService {
  private readonly logger = new Logger(FailedRetrievalsService.name);

  // Constants
  private readonly MAX_DATE_RANGE_DAYS = 30;
  private readonly MAX_PAGE_LIMIT = 100;
  private readonly TOP_ERRORS_LIMIT = 10;
  private readonly TOP_PROVIDERS_LIMIT = 10;

  constructor(
    @InjectRepository(Retrieval)
    private readonly retrievalRepo: Repository<Retrieval>,
  ) {}

  /**
   * Get failed retrievals with pagination and filtering
   *
   * @param startDate - Start date for the query
   * @param endDate - End date for the query
   * @param page - Page number (1-indexed)
   * @param limit - Items per page
   * @param search - Optional search term (endpoint, error message)
   * @param spAddress - Optional provider filter
   * @param serviceType - Optional service type filter
   * @returns Paginated failed retrievals with summary
   */
  async getFailedRetrievals(
    startDate: Date,
    endDate: Date,
    page: number = 1,
    limit: number = 20,
    search?: string,
    spAddress?: string,
    serviceType?: ServiceType,
  ): Promise<FailedRetrievalsResponseDto> {
    try {
      this.validateDateRange(startDate, endDate, this.MAX_DATE_RANGE_DAYS);
      this.validatePagination(page, limit);

      // Build query with proper joins and filtering
      const queryBuilder = this.retrievalRepo
        .createQueryBuilder("retrieval")
        .leftJoin("retrieval.deal", "deal")
        .leftJoinAndSelect("deal.storageProvider", "storageProvider")
        .select([
          "retrieval",
          "deal.id",
          "storageProvider.address",
          "storageProvider.name",
          "storageProvider.providerId",
        ])
        .where("retrieval.createdAt BETWEEN :startDate AND :endDate", { startDate, endDate })
        .andWhere("retrieval.status IN (:...statuses)", { statuses: [RetrievalStatus.FAILED, RetrievalStatus.TIMEOUT] })
        .andWhere("retrieval.errorMessage IS NOT NULL");

      // Add service type filter
      if (serviceType) {
        queryBuilder.andWhere("retrieval.serviceType = :serviceType", { serviceType });
      }

      // Add provider filter (proper SQL join)
      if (spAddress) {
        queryBuilder.andWhere("deal.spAddress = :spAddress", { spAddress });
      }

      // Add search filter
      if (search) {
        queryBuilder.andWhere("(retrieval.retrievalEndpoint ILIKE :search OR retrieval.errorMessage ILIKE :search)", {
          search: `%${search}%`,
        });
      }

      // Execute query with pagination
      const [failedRetrievals, total] = await queryBuilder
        .orderBy("retrieval.createdAt", "DESC")
        .skip((page - 1) * limit)
        .take(limit)
        .getManyAndCount();

      // Map to DTOs
      const failedRetrievalDtos = this.mapToFailedRetrievalDtos(failedRetrievals);

      // Calculate summary
      const summary = await this.calculateSummary(startDate, endDate, spAddress, serviceType);

      // Build pagination metadata
      const pagination = this.buildPaginationDto(page, limit, total);

      return {
        failedRetrievals: failedRetrievalDtos,
        pagination,
        dateRange: {
          startDate: startDate.toISOString().split("T")[0],
          endDate: endDate.toISOString().split("T")[0],
        },
        summary,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch failed retrievals: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get error summary statistics
   *
   * @param startDate - Start date for the query
   * @param endDate - End date for the query
   * @returns Error summary with most common errors and failures by service type/provider
   */
  async getErrorSummary(startDate: Date, endDate: Date) {
    try {
      this.validateDateRange(startDate, endDate, this.MAX_DATE_RANGE_DAYS);

      return await this.calculateSummary(startDate, endDate);
    } catch (error) {
      this.logger.error(`Failed to fetch error summary: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Map Retrieval entities to FailedRetrievalDto
   *
   * @private
   */
  private mapToFailedRetrievalDtos(retrievals: Retrieval[]): FailedRetrievalDto[] {
    return retrievals.map((retrieval) => ({
      id: retrieval.id,
      dealId: retrieval.dealId,
      serviceType: retrieval.serviceType,
      retrievalEndpoint: retrieval.retrievalEndpoint,
      status: retrieval.status,
      startedAt: retrieval.startedAt,
      completedAt: retrieval.completedAt || undefined,
      latencyMs: retrieval.latencyMs || undefined,
      throughputBps: retrieval.throughputBps || undefined,
      bytesRetrieved: retrieval.bytesRetrieved || undefined,
      ttfbMs: retrieval.ttfbMs || undefined,
      responseCode: retrieval.responseCode || undefined,
      errorMessage: retrieval.errorMessage || "",
      retryCount: retrieval.retryCount,
      createdAt: retrieval.createdAt,
      updatedAt: retrieval.updatedAt,
      spAddress: retrieval.deal?.spAddress || undefined,
      fileName: retrieval.deal?.fileName || undefined,
      pieceCid: retrieval.deal?.pieceCid || undefined,
      storageProvider: retrieval.deal?.storageProvider || undefined,
    }));
  }

  /**
   * Calculate summary statistics for failed retrievals
   *
   * @private
   */
  private async calculateSummary(startDate: Date, endDate: Date, spAddress?: string, serviceType?: string) {
    // Build query with proper joins and filtering
    const queryBuilder = this.retrievalRepo
      .createQueryBuilder("retrieval")
      .leftJoinAndSelect("retrieval.deal", "deal")
      .select([
        "retrieval.id",
        "retrieval.serviceType",
        "retrieval.errorMessage",
        "retrieval.responseCode",
        "retrieval.dealId",
        "deal.spAddress",
      ])
      .where("retrieval.createdAt BETWEEN :startDate AND :endDate", { startDate, endDate })
      .andWhere("retrieval.status IN (:...statuses)", { statuses: [RetrievalStatus.FAILED, RetrievalStatus.TIMEOUT] })
      .andWhere("retrieval.errorMessage IS NOT NULL");

    // Add service type filter
    if (serviceType) {
      queryBuilder.andWhere("retrieval.serviceType = :serviceType", { serviceType });
    }

    // Add provider filter
    if (spAddress) {
      queryBuilder.andWhere("deal.spAddress = :spAddress", { spAddress });
    }

    const filteredRetrievals = await queryBuilder.getMany();

    const totalFailedRetrievals = filteredRetrievals.length;
    const uniqueProviders = new Set(filteredRetrievals.map((r) => r.deal?.spAddress).filter(Boolean)).size;
    const uniqueServiceTypes = new Set(filteredRetrievals.map((r) => r.serviceType)).size;

    // Calculate most common errors
    const errorCounts = new Map<string, { responseCode?: number; count: number }>();
    filteredRetrievals.forEach((retrieval) => {
      const key = `${retrieval.errorMessage}:${retrieval.responseCode || "N/A"}`;
      if (errorCounts.has(key)) {
        errorCounts.get(key)!.count++;
      } else {
        errorCounts.set(key, {
          responseCode: retrieval.responseCode || undefined,
          count: 1,
        });
      }
    });

    const mostCommonErrors: RetrievalErrorSummaryDto[] = Array.from(errorCounts.entries())
      .map(([key, value]) => ({
        errorMessage: key.split(":")[0],
        responseCode: value.responseCode,
        count: value.count,
        percentage: totalFailedRetrievals > 0 ? Math.round((value.count / totalFailedRetrievals) * 100 * 100) / 100 : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, this.TOP_ERRORS_LIMIT);

    // Calculate failures by service type
    const serviceTypeFailures = new Map<string, { count: number; errors: string[] }>();
    filteredRetrievals.forEach((retrieval) => {
      const serviceTypeKey = retrieval.serviceType;
      if (serviceTypeFailures.has(serviceTypeKey)) {
        const existing = serviceTypeFailures.get(serviceTypeKey)!;
        existing.count++;
        existing.errors.push(retrieval.errorMessage || "Unknown error");
      } else {
        serviceTypeFailures.set(serviceTypeKey, {
          count: 1,
          errors: [retrieval.errorMessage || "Unknown error"],
        });
      }
    });

    const failuresByServiceType: ServiceTypeFailureStatsDto[] = Array.from(serviceTypeFailures.entries())
      .map(([serviceType, data]) => {
        // Find most common error for this service type
        const errorCounts = new Map<string, number>();
        data.errors.forEach((error) => {
          errorCounts.set(error, (errorCounts.get(error) || 0) + 1);
        });
        const mostCommonError =
          Array.from(errorCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "Unknown error";

        return {
          serviceType: serviceType as any,
          failedRetrievals: data.count,
          percentage:
            totalFailedRetrievals > 0 ? Math.round((data.count / totalFailedRetrievals) * 100 * 100) / 100 : 0,
          mostCommonError,
        };
      })
      .sort((a, b) => b.failedRetrievals - a.failedRetrievals);

    // Calculate failures by provider
    const providerFailures = new Map<string, { count: number; errors: string[] }>();
    filteredRetrievals.forEach((retrieval) => {
      const providerKey = retrieval.deal?.spAddress;
      if (!providerKey) return;

      if (providerFailures.has(providerKey)) {
        const existing = providerFailures.get(providerKey)!;
        existing.count++;
        existing.errors.push(retrieval.errorMessage || "Unknown error");
      } else {
        providerFailures.set(providerKey, {
          count: 1,
          errors: [retrieval.errorMessage || "Unknown error"],
        });
      }
    });

    const failuresByProvider: ProviderRetrievalFailureStatsDto[] = Array.from(providerFailures.entries())
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
          failedRetrievals: data.count,
          percentage:
            totalFailedRetrievals > 0 ? Math.round((data.count / totalFailedRetrievals) * 100 * 100) / 100 : 0,
          mostCommonError,
        };
      })
      .sort((a, b) => b.failedRetrievals - a.failedRetrievals)
      .slice(0, this.TOP_PROVIDERS_LIMIT);

    return {
      totalFailedRetrievals,
      uniqueProviders,
      uniqueServiceTypes,
      mostCommonErrors,
      failuresByServiceType,
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

    if (Number.isNaN(limit) || limit < 1 || limit > this.MAX_PAGE_LIMIT) {
      throw new BadRequestException(`Limit must be a number between 1 and ${this.MAX_PAGE_LIMIT}.`);
    }
  }
}
