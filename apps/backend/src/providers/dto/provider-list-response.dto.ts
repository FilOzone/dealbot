import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class StorageProviderDto {
  @ApiProperty({ description: "Storage provider address", example: "f01234" })
  address!: string;

  @ApiPropertyOptional({ description: "On-chain provider ID", type: String })
  providerId?: string;

  @ApiProperty({ description: "Storage provider name" })
  name!: string;

  @ApiProperty({ description: "Storage provider description" })
  description!: string;

  @ApiProperty({ description: "Payee address to receive funds" })
  payee!: string;

  @ApiProperty({ description: "Service URL" })
  serviceUrl!: string;

  @ApiProperty({ description: "Whether the provider is currently active" })
  isActive!: boolean;

  @ApiProperty({ description: "Whether the provider is approved by Dealbot" })
  isApproved!: boolean;

  @ApiProperty({ description: "Provider location" })
  location!: string;

  @ApiProperty({ description: "Free-form JSON metadata", type: "object", additionalProperties: true })
  metadata!: Record<string, any>;

  @ApiProperty({ description: "When the provider was created" })
  createdAt!: Date;

  @ApiProperty({ description: "When the provider was last updated" })
  updatedAt!: Date;
}

export class ProviderListResponseDto {
  @ApiProperty({
    description: "List of storage providers",
    type: [StorageProviderDto],
  })
  providers!: StorageProviderDto[];

  @ApiProperty({
    description: "Total number of providers matching filters",
  })
  total!: number;

  @ApiProperty({
    description: "Number of providers in the current page",
  })
  count!: number;

  @ApiProperty({
    description: "Pagination offset",
  })
  offset!: number;

  @ApiProperty({
    description: "Pagination limit",
  })
  limit!: number;
}
