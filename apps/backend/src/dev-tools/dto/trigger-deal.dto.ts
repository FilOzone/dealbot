import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

export class TriggerDealQueryDto {
  @ApiProperty({
    description: "Storage provider address",
    example: "0x1234567890abcdef1234567890abcdef12345678",
  })
  @IsString()
  @IsNotEmpty()
  spAddress: string;
}

export class TriggerDealResponseDto {
  @ApiProperty({ description: "Deal ID" })
  id: string;

  @ApiProperty({ description: "Piece CID" })
  pieceCid: string;

  @ApiProperty({ description: "Deal status" })
  status: string;

  @ApiProperty({ description: "File name" })
  fileName: string;

  @ApiProperty({ description: "File size in bytes" })
  fileSize: number;

  @ApiProperty({ description: "Deal latency in milliseconds", required: false })
  dealLatencyMs?: number;

  @ApiProperty({ description: "Ingest latency in milliseconds", required: false })
  ingestLatencyMs?: number;

  @ApiProperty({ description: "Service types applied" })
  serviceTypes: string[];

  @ApiProperty({ description: "Storage provider address" })
  spAddress: string;

  @ApiProperty({ description: "Error message if deal failed", required: false })
  errorMessage?: string;
}
