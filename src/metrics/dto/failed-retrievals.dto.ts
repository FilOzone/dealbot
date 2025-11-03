import { ApiProperty } from "@nestjs/swagger";
import { RetrievalStatus, ServiceType } from "../../database/types.js";

/**
 * Failed retrieval details with error information
 */

export class StorageProviderDto {
  @ApiProperty({
    description: "Storage provider address",
    example: "0x1234567890abcdef",
  })
  address: string;

  @ApiProperty({
    description: "Storage provider name",
    example: "Example Storage Provider",
  })
  name: string;

  @ApiProperty({
    description: "Storage provider provider ID",
    example: 1,
  })
  providerId?: number;
}

export class FailedRetrievalDto {
  @ApiProperty({
    description: "Unique retrieval identifier",
    example: "550e8400-e29b-41d4-a716-446655440000",
  })
  id: string;

  @ApiProperty({
    description: "Associated deal identifier",
    example: "550e8400-e29b-41d4-a716-446655440001",
  })
  dealId: string;

  @ApiProperty({
    description: "Service type used for retrieval",
    enum: ServiceType,
    example: ServiceType.CDN,
  })
  serviceType: ServiceType;

  @ApiProperty({
    description: "Retrieval endpoint URL",
    example: "https://cdn.example.com/retrieve/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  })
  retrievalEndpoint: string;

  @ApiProperty({
    description: "Retrieval status",
    enum: RetrievalStatus,
    example: RetrievalStatus.FAILED,
  })
  status: RetrievalStatus;

  @ApiProperty({
    description: "Retrieval start time",
    example: "2024-01-15T10:30:00.000Z",
  })
  startedAt: Date;

  @ApiProperty({
    description: "Retrieval completion time",
    example: "2024-01-15T10:30:30.000Z",
    nullable: true,
  })
  completedAt?: Date;

  @ApiProperty({
    description: "Latency in milliseconds",
    example: 1500,
    nullable: true,
  })
  latencyMs?: number;

  @ApiProperty({
    description: "Throughput in bits per second",
    example: 1048576,
    nullable: true,
  })
  throughputBps?: number;

  @ApiProperty({
    description: "Bytes retrieved",
    example: 524288,
    nullable: true,
  })
  bytesRetrieved?: number;

  @ApiProperty({
    description: "Time to first byte in milliseconds",
    example: 250,
    nullable: true,
  })
  ttfbMs?: number;

  @ApiProperty({
    description: "HTTP response code",
    example: 500,
    nullable: true,
  })
  responseCode?: number;

  @ApiProperty({
    description: "Error message describing the failure",
    example: "Connection timeout after 30 seconds",
  })
  errorMessage: string;

  @ApiProperty({
    description: "Number of retry attempts",
    example: 3,
  })
  retryCount: number;

  @ApiProperty({
    description: "Retrieval creation timestamp",
    example: "2024-01-15T10:30:00.000Z",
  })
  createdAt: Date;

  @ApiProperty({
    description: "Last update timestamp",
    example: "2024-01-15T10:30:30.000Z",
  })
  updatedAt: Date;

  @ApiProperty({
    description: "Storage provider address from associated deal",
    example: "0x1234567890abcdef",
    nullable: true,
  })
  spAddress?: string;

  @ApiProperty({
    description: "File name from associated deal",
    example: "dataset-2024-01-15.csv",
    nullable: true,
  })
  fileName?: string;

  @ApiProperty({
    description: "Piece CID from associated deal",
    example: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    nullable: true,
  })
  pieceCid?: string;

  @ApiProperty({
    description: "Storage provider details from associated deal",
    type: StorageProviderDto,
    nullable: true,
  })
  storageProvider?: StorageProviderDto;
}

/**
 * Error summary statistics for retrievals
 */
export class RetrievalErrorSummaryDto {
  @ApiProperty({
    description: "Error message",
    example: "Connection timeout",
  })
  errorMessage: string;

  @ApiProperty({
    description: "HTTP response code",
    example: 500,
    nullable: true,
  })
  responseCode?: number;

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
 * Service type failure statistics
 */
export class ServiceTypeFailureStatsDto {
  @ApiProperty({
    description: "Service type",
    enum: ServiceType,
    example: ServiceType.CDN,
  })
  serviceType: ServiceType;

  @ApiProperty({
    description: "Number of failed retrievals",
    example: 8,
  })
  failedRetrievals: number;

  @ApiProperty({
    description: "Percentage of total failures",
    example: 13.6,
  })
  percentage: number;

  @ApiProperty({
    description: "Most common error for this service type",
    example: "Connection timeout",
  })
  mostCommonError: string;
}

/**
 * Provider failure statistics for retrievals
 */
export class ProviderRetrievalFailureStatsDto {
  @ApiProperty({
    description: "Storage provider address",
    example: "0x1234567890abcdef",
  })
  spAddress: string;

  @ApiProperty({
    description: "Number of failed retrievals",
    example: 12,
  })
  failedRetrievals: number;

  @ApiProperty({
    description: "Percentage of total failures",
    example: 20.4,
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
 * Failed retrievals response with pagination and summary
 */
export class FailedRetrievalsResponseDto {
  @ApiProperty({
    description: "Array of failed retrievals",
    type: [FailedRetrievalDto],
  })
  failedRetrievals: FailedRetrievalDto[];

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
    description: "Summary statistics for failed retrievals",
    example: {
      totalFailedRetrievals: 150,
      uniqueProviders: 8,
      uniqueServiceTypes: 3,
      mostCommonErrors: [],
      failuresByServiceType: [],
      failuresByProvider: [],
    },
  })
  summary: {
    totalFailedRetrievals: number;
    uniqueProviders: number;
    uniqueServiceTypes: number;
    mostCommonErrors: RetrievalErrorSummaryDto[];
    failuresByServiceType: ServiceTypeFailureStatsDto[];
    failuresByProvider: ProviderRetrievalFailureStatsDto[];
  };
}
