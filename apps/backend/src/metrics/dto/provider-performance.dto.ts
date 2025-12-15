import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * DTO for storage provider info
 */
export class Provider {
  @ApiProperty({ description: "Storage provider address" })
  address: string;

  @ApiProperty({ description: "Storage provider name" })
  name: string;

  @ApiProperty({ description: "Storage provider description" })
  description: string;

  @ApiProperty({ description: "Payee address to receive funds" })
  payee: string;

  @ApiProperty({ description: "Service Url" })
  serviceUrl: string;

  @ApiProperty({ description: "Is storage provider active" })
  isActive: boolean;

  @ApiProperty({ description: "Is storage provider approved by fwss" })
  isApproved: boolean;

  @ApiProperty({ description: "Region" })
  region: string;

  @ApiProperty({ description: "Metadata" })
  metadata: Record<string, any>;

  @ApiProperty({ description: "Created At" })
  createdAt: Date;

  @ApiProperty({ description: "Updated at" })
  updatedAt: Date;
}

/**
 * DTO for storage provider performance metrics
 */
export class ProviderPerformanceDto {
  @ApiProperty({ description: "Storage provider address" })
  spAddress: string;

  @ApiProperty({ description: "Total deals in last 7 days" })
  totalDeals: number;

  @ApiProperty({ description: "Successful deals in last 7 days" })
  successfulDeals: number;

  @ApiProperty({ description: "Failed deals in last 7 days" })
  failedDeals: number;

  @ApiProperty({ description: "Deal success rate percentage (0-100)" })
  dealSuccessRate: number;

  @ApiProperty({ description: "Average ingest latency in milliseconds" })
  avgIngestLatencyMs: number;

  @ApiProperty({ description: "Average chain latency in milliseconds" })
  avgChainLatencyMs: number;

  @ApiProperty({ description: "Average deal latency in milliseconds" })
  avgDealLatencyMs: number;

  @ApiProperty({ description: "Average ingest throughput in bytes per second" })
  avgIngestThroughputBps: number;

  @ApiProperty({ description: "Total data stored in bytes" })
  totalDataStoredBytes: string;

  @ApiProperty({ description: "Total retrievals in last 7 days" })
  totalRetrievals: number;

  @ApiProperty({ description: "Successful retrievals in last 7 days" })
  successfulRetrievals: number;

  @ApiProperty({ description: "Failed retrievals in last 7 days" })
  failedRetrievals: number;

  @ApiProperty({ description: "Retrieval success rate percentage (0-100)" })
  retrievalSuccessRate: number;

  @ApiProperty({ description: "Average retrieval latency in milliseconds" })
  avgRetrievalLatencyMs: number;

  @ApiProperty({ description: "Average retrieval TTFB in milliseconds" })
  avgRetrievalTtfbMs: number;

  @ApiProperty({
    description: "Average retrieval throughput in bytes per second",
  })
  avgRetrievalThroughputBps: number;

  @ApiProperty({ description: "Total data retrieved in bytes" })
  totalDataRetrievedBytes: string;

  @ApiProperty({ description: "Total IPFS retrievals" })
  totalIpfsRetrievals: number;

  @ApiProperty({ description: "Successful IPFS retrievals" })
  successfulIpfsRetrievals: number;

  @ApiProperty({ description: "Failed IPFS retrievals" })
  failedIpfsRetrievals: number;

  @ApiProperty({
    description: "IPFS retrieval success rate percentage (0-100)",
  })
  ipfsRetrievalSuccessRate: number;

  @ApiProperty({
    description: "Average IPFS retrieval latency in milliseconds",
  })
  avgIpfsRetrievalLatencyMs: number;

  @ApiProperty({ description: "Average IPFS retrieval TTFB in milliseconds" })
  avgIpfsRetrievalTtfbMs: number;

  @ApiProperty({
    description: "Average IPFS retrieval throughput in bytes per second",
  })
  avgIpfsRetrievalThroughputBps: number;

  @ApiProperty({ description: "Total deals with IPNI tracking" })
  totalIpniDeals: number;

  @ApiProperty({ description: "IPNI deals that reached indexed status" })
  ipniIndexedDeals: number;

  @ApiProperty({ description: "IPNI deals that reached advertised status" })
  ipniAdvertisedDeals: number;

  @ApiProperty({ description: "IPNI deals that reached retrieved status" })
  ipniRetrievedDeals: number;

  @ApiProperty({
    description: "IPNI deals that are verified with filecoinpin.contact",
  })
  ipniVerifiedDeals: number;

  @ApiProperty({ description: "IPNI deals that failed" })
  ipniFailedDeals: number;

  @ApiProperty({ description: "IPNI success rate percentage (0-100)" })
  ipniSuccessRate: number;

  @ApiProperty({ description: "Average time to IPNI index in milliseconds" })
  avgIpniTimeToIndexMs: number;

  @ApiProperty({
    description: "Average time to IPNI advertise in milliseconds",
  })
  avgIpniTimeToAdvertiseMs: number;

  @ApiProperty({ description: "Average time to IPNI retrieve in milliseconds" })
  avgIpniTimeToRetrieveMs: number;

  @ApiProperty({ description: "Average time to IPNI verify in milliseconds" })
  avgIpniTimeToVerifyMs: number;

  @ApiProperty({ description: "Health score (0-100)" })
  healthScore: number;

  @ApiPropertyOptional({ description: "Average deal size in bytes" })
  avgDealSize?: number;

  @ApiProperty({ description: "Last deal timestamp" })
  lastDealAt: Date;

  @ApiProperty({ description: "Last retrieval timestamp" })
  lastRetrievalAt: Date;

  @ApiProperty({ description: "Data last refreshed at" })
  refreshedAt: Date;
}

/**
 * DTO for combined provider performance
 */
export class ProviderCombinedPerformanceDto {
  @ApiProperty({ description: "Storage provider address" })
  provider: Provider;

  @ApiProperty({ type: ProviderPerformanceDto })
  weekly: ProviderPerformanceDto | null;

  @ApiProperty({ type: ProviderPerformanceDto })
  allTime: ProviderPerformanceDto | null;
}

/**
 * DTO for provider list response
 */
export class ProviderListResponseDto {
  @ApiProperty({ type: [Provider], description: "List of provider" })
  providers: Provider[];

  @ApiProperty({ description: "Total number of providers" })
  total: number;

  @ApiProperty({ description: "Number of providers returned" })
  count: number;

  @ApiProperty({ description: "Pagination offset" })
  offset: number;

  @ApiProperty({ description: "Pagination limit" })
  limit: number;
}

/**
 * DTO for provider metrics list response
 * Returns combined weekly and all-time metrics for each provider
 */
export class ProviderMetricsListResponseDto {
  @ApiProperty({
    type: [ProviderCombinedPerformanceDto],
    description: "List of providers with combined metrics",
  })
  providers: ProviderCombinedPerformanceDto[];

  @ApiProperty({ description: "Total number of providers" })
  total: number;

  @ApiProperty({ description: "Number of providers returned" })
  count: number;

  @ApiProperty({ description: "Pagination offset" })
  offset: number;

  @ApiProperty({ description: "Pagination limit" })
  limit: number;
}

/**
 * DTO for provider metrics over time window
 */
export class WindowDto {
  @ApiProperty({ description: "Start Date" })
  startDate: string;

  @ApiProperty({ description: "End Date" })
  endDate: string;

  @ApiProperty({ description: "Number of days" })
  days: number;

  @ApiProperty({ description: "Time window preset if no custom date range" })
  preset: string | null;
}

export class ProviderWindowPerformanceDto {
  @ApiProperty({ type: Provider })
  provider: Provider;

  @ApiProperty({ type: WindowDto })
  window: WindowDto;

  @ApiProperty({ type: ProviderPerformanceDto })
  metrics: ProviderPerformanceDto;
}
