import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString, IsUUID, ValidateIf } from "class-validator";

export class TriggerRetrievalQueryDto {
  @ApiProperty({
    description: "Deal ID to retrieve",
    required: false,
    example: "550e8400-e29b-41d4-a716-446655440000",
  })
  @IsUUID()
  @IsOptional()
  @ValidateIf((o) => !o.spAddress)
  dealId?: string;

  @ApiProperty({
    description: "Storage provider address (uses most recent deal for this SP)",
    required: false,
    example: "0x1234567890abcdef1234567890abcdef12345678",
  })
  @IsString()
  @IsOptional()
  @ValidateIf((o) => !o.dealId)
  spAddress?: string;
}

export class RetrievalMethodResultDto {
  @ApiProperty({ description: "Retrieval method used" })
  method: string;

  @ApiProperty({ description: "Whether retrieval succeeded" })
  success: boolean;

  @ApiProperty({ description: "URL used for retrieval" })
  url: string;

  @ApiProperty({ description: "Latency in milliseconds", required: false })
  latencyMs?: number;

  @ApiProperty({ description: "Time to first byte in milliseconds", required: false })
  ttfbMs?: number;

  @ApiProperty({ description: "Throughput in bytes per second", required: false })
  throughputBps?: number;

  @ApiProperty({ description: "HTTP status code", required: false })
  statusCode?: number;

  @ApiProperty({ description: "Response size in bytes", required: false })
  responseSize?: number;

  @ApiProperty({ description: "Error message if retrieval failed", required: false })
  error?: string;

  @ApiProperty({ description: "Number of retry attempts", required: false })
  retryCount?: number;
}

export class TriggerRetrievalResponseDto {
  @ApiProperty({ description: "Deal ID that was retrieved" })
  dealId: string;

  @ApiProperty({ description: "Piece CID" })
  pieceCid: string;

  @ApiProperty({ description: "Storage provider address" })
  spAddress: string;

  @ApiProperty({ description: "Results for each retrieval method", type: [RetrievalMethodResultDto] })
  results: RetrievalMethodResultDto[];

  @ApiProperty({ description: "Summary statistics" })
  summary: {
    totalMethods: number;
    successfulMethods: number;
    failedMethods: number;
    fastestMethod?: string;
    fastestLatency?: number;
  };

  @ApiProperty({ description: "Timestamp of retrieval test" })
  testedAt: Date;
}
