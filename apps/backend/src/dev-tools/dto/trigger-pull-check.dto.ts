import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

export class TriggerPullCheckQueryDto {
  @ApiProperty({
    description: "Storage provider address to run the pull check against",
    example: "0x1234567890abcdef1234567890abcdef12345678",
  })
  @IsString()
  @IsNotEmpty()
  spAddress: string;
}

export class TriggerPullCheckResponseDto {
  @ApiProperty({ description: "Pull check identifier" })
  id: string;

  @ApiProperty({ description: "Storage provider address" })
  spAddress: string;

  @ApiProperty({ description: "Hosted piece CID for this pull check" })
  pieceCid: string;

  @ApiProperty({ description: "Pull-check lifecycle status" })
  status: string;

  @ApiProperty({ description: "Hosted piece source URL the SP must pull from" })
  sourceUrl: string;

  @ApiProperty({ description: "Pull-check creation timestamp" })
  createdAt: Date;
}

export class PullCheckStatusResponseDto {
  @ApiProperty({ description: "Pull check identifier" })
  id: string;

  @ApiProperty({ description: "Storage provider address" })
  spAddress: string;

  @ApiProperty({ description: "Hosted piece CID" })
  pieceCid: string;

  @ApiProperty({ description: "Pull-check lifecycle status" })
  status: string;

  @ApiProperty({ description: "Latest provider-reported pull status", required: false })
  providerStatus?: string;

  @ApiProperty({ description: "Verification status, when applicable", required: false })
  verificationStatus?: string;

  @ApiProperty({ description: "Time from request submission to SP acknowledgement (ms)", required: false })
  requestLatencyMs?: number;

  @ApiProperty({ description: "Time from request submission to terminal SP status (ms)", required: false })
  completionLatencyMs?: number;

  @ApiProperty({ description: "Failure reason, when applicable", required: false })
  failureReason?: string;

  @ApiProperty({ description: "Underlying error message, when applicable", required: false })
  errorMessage?: string;

  @ApiProperty({ description: "Hosted piece source URL the SP was asked to pull from" })
  sourceUrl: string;

  @ApiProperty({ description: "Time at which DealBot started the pull request", required: false })
  requestStartedAt?: Date;

  @ApiProperty({ description: "Time at which DealBot reached a terminal pull state", required: false })
  completedAt?: Date;
}
