import { ApiProperty } from "@nestjs/swagger";
import { DealStatus } from "../../database/types.js";

/**
 * Failed deal details with error information
 */
export class FailedDealDto {
  @ApiProperty({
    description: "Unique deal identifier",
    example: "550e8400-e29b-41d4-a716-446655440000",
  })
  id: string;

  @ApiProperty({
    description: "Name of the file",
    example: "dataset-2024-01-15.csv",
  })
  fileName: string;

  @ApiProperty({
    description: "File size in bytes",
    example: 1048576,
  })
  fileSize: number;

  @ApiProperty({
    description: "Dataset identifier",
    example: 12345,
    nullable: true,
  })
  dataSetId?: number;

  @ApiProperty({
    description: "Piece CID",
    example: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    nullable: true,
  })
  pieceCid?: string;

  @ApiProperty({
    description: "Storage provider address",
    example: "0x1234567890abcdef",
  })
  spAddress: string;

  @ApiProperty({
    description: "Deal status",
    enum: DealStatus,
    example: DealStatus.FAILED,
  })
  status: DealStatus;

  @ApiProperty({
    description: "Error message describing the failure",
    example: "Connection timeout after 30 seconds",
  })
  errorMessage: string;

  @ApiProperty({
    description: "Error code for categorization",
    example: "TIMEOUT",
    nullable: true,
  })
  errorCode?: string;

  @ApiProperty({
    description: "Number of retry attempts",
    example: 3,
  })
  retryCount: number;

  @ApiProperty({
    description: "Deal creation timestamp",
    example: "2024-01-15T10:30:00.000Z",
  })
  createdAt: Date;

  @ApiProperty({
    description: "Last update timestamp",
    example: "2024-01-15T10:35:00.000Z",
  })
  updatedAt: Date;

  @ApiProperty({
    description: "Upload start time",
    example: "2024-01-15T10:30:05.000Z",
    nullable: true,
  })
  uploadStartTime?: Date;

  @ApiProperty({
    description: "Upload end time",
    example: "2024-01-15T10:32:00.000Z",
    nullable: true,
  })
  uploadEndTime?: Date;

  @ApiProperty({
    description: "Piece added to provider time",
    example: "2024-01-15T10:33:00.000Z",
    nullable: true,
  })
  pieceAddedTime?: Date;

  @ApiProperty({
    description: "Deal confirmed on chain time",
    example: "2024-01-15T10:35:00.000Z",
    nullable: true,
  })
  dealConfirmedTime?: Date;
}

/**
 * Error summary statistics
 */
export class ErrorSummaryDto {
  @ApiProperty({
    description: "Error code",
    example: "TIMEOUT",
  })
  errorCode: string;

  @ApiProperty({
    description: "Error message",
    example: "Connection timeout",
  })
  errorMessage: string;

  @ApiProperty({
    description: "Number of occurrences",
    example: 15,
  })
  count: number;

  @ApiProperty({
    description: "Percentage of total failures",
    example: 25.5,
  })
  percentage: number;
}

/**
 * Provider failure statistics
 */
export class ProviderFailureStatsDto {
  @ApiProperty({
    description: "Storage provider address",
    example: "0x1234567890abcdef",
  })
  spAddress: string;

  @ApiProperty({
    description: "Number of failed deals",
    example: 8,
  })
  failedDeals: number;

  @ApiProperty({
    description: "Percentage of total failures",
    example: 13.6,
  })
  percentage: number;

  @ApiProperty({
    description: "Most common error for this provider",
    example: "Connection timeout",
  })
  mostCommonError: string;
}

/**
 * Pagination metadata
 */
export class PaginationDto {
  @ApiProperty({
    description: "Current page number",
    example: 1,
  })
  page: number;

  @ApiProperty({
    description: "Number of items per page",
    example: 20,
  })
  limit: number;

  @ApiProperty({
    description: "Total number of items",
    example: 150,
  })
  total: number;

  @ApiProperty({
    description: "Total number of pages",
    example: 8,
  })
  totalPages: number;

  @ApiProperty({
    description: "Whether there is a next page",
    example: true,
  })
  hasNext: boolean;

  @ApiProperty({
    description: "Whether there is a previous page",
    example: false,
  })
  hasPrev: boolean;
}

/**
 * Failed deals response with pagination and summary
 */
export class FailedDealsResponseDto {
  @ApiProperty({
    description: "Array of failed deals",
    type: [FailedDealDto],
  })
  failedDeals: FailedDealDto[];

  @ApiProperty({
    description: "Pagination information",
    type: PaginationDto,
  })
  pagination: PaginationDto;

  @ApiProperty({
    description: "Date range for the query",
    example: {
      startDate: "2024-01-01",
      endDate: "2024-01-07",
    },
  })
  dateRange: {
    startDate: string;
    endDate: string;
  };

  @ApiProperty({
    description: "Summary statistics for failed deals",
    example: {
      totalFailedDeals: 150,
      uniqueProviders: 8,
      mostCommonErrors: [],
      failuresByProvider: [],
    },
  })
  summary: {
    totalFailedDeals: number;
    uniqueProviders: number;
    mostCommonErrors: ErrorSummaryDto[];
    failuresByProvider: ProviderFailureStatsDto[];
  };
}
