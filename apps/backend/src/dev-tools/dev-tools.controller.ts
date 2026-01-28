import { Controller, Get, Logger, Param, Query } from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { DevToolsService } from "./dev-tools.service.js";
import { TriggerDealResponseDto } from "./dto/trigger-deal.dto.js";
import { TriggerRetrievalResponseDto } from "./dto/trigger-retrieval.dto.js";

@ApiTags("Dev Tools")
@Controller("api/dev")
export class DevToolsController {
  private readonly logger = new Logger(DevToolsController.name);

  constructor(private readonly devToolsService: DevToolsService) {}

  @Get("providers")
  @ApiOperation({ summary: "List available storage providers" })
  @ApiResponse({
    status: 200,
    description: "List of available storage providers for testing",
  })
  listProviders() {
    this.logger.log("GET /api/dev/providers");
    return this.devToolsService.listProviders();
  }

  @Get("deal")
  @ApiOperation({ summary: "Trigger a deal for a specific SP (returns immediately, processing in background)" })
  @ApiQuery({
    name: "spAddress",
    required: true,
    description: "Storage provider address",
    example: "0x1234567890abcdef1234567890abcdef12345678",
  })
  @ApiResponse({
    status: 200,
    description: "Deal accepted - use /api/dev/deal/status?dealId=... to check progress",
    type: TriggerDealResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: "Storage provider not found",
  })
  @ApiResponse({
    status: 400,
    description: "Storage provider is not active",
  })
  async triggerDeal(@Query("spAddress") spAddress: string): Promise<TriggerDealResponseDto> {
    this.logger.log(`GET /api/dev/deal?spAddress=${spAddress}`);
    return this.devToolsService.triggerDeal(spAddress);
  }

  @Get("deals/:dealId")
  @ApiOperation({ summary: "Get deal status by ID" })
  @ApiResponse({
    status: 200,
    description: "Deal status",
    type: TriggerDealResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: "Deal not found",
  })
  async getDealStatus(@Param("dealId") dealId: string): Promise<TriggerDealResponseDto> {
    this.logger.log(`GET /api/dev/deals/${dealId}`);
    return this.devToolsService.getDeal(dealId);
  }

  @Get("data-fetch")
  @ApiOperation({ summary: "Trigger data fetch for a deal" })
  @ApiQuery({
    name: "dealId",
    required: false,
    description: "Specific deal ID to fetch data for",
    example: "550e8400-e29b-41d4-a716-446655440000",
  })
  @ApiQuery({
    name: "spAddress",
    required: false,
    description: "Storage provider address (uses most recent deal for this SP)",
    example: "0x1234567890abcdef1234567890abcdef12345678",
  })
  @ApiResponse({
    status: 200,
    description: "Data fetch test results",
    type: TriggerRetrievalResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: "Neither dealId nor spAddress provided",
  })
  @ApiResponse({
    status: 404,
    description: "Deal or storage provider not found",
  })
  async triggerDataFetch(
    @Query("dealId") dealId?: string,
    @Query("spAddress") spAddress?: string,
  ): Promise<TriggerRetrievalResponseDto> {
    this.logger.log(`GET /api/dev/data-fetch?dealId=${dealId}&spAddress=${spAddress}`);
    return this.devToolsService.triggerRetrieval(dealId, spAddress);
  }

  // Alias for backwards compatibility with the plan
  @Get("retrieval")
  @ApiOperation({ summary: "Trigger retrieval for a deal (alias for data-fetch)" })
  @ApiQuery({
    name: "dealId",
    required: false,
    description: "Specific deal ID",
    example: "550e8400-e29b-41d4-a716-446655440000",
  })
  @ApiQuery({
    name: "spAddress",
    required: false,
    description: "Storage provider address (uses most recent deal for this SP)",
    example: "0x1234567890abcdef1234567890abcdef12345678",
  })
  @ApiResponse({
    status: 200,
    description: "Test results",
    type: TriggerRetrievalResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: "Neither dealId nor spAddress provided",
  })
  @ApiResponse({
    status: 404,
    description: "Deal or storage provider not found",
  })
  async triggerRetrieval(
    @Query("dealId") dealId?: string,
    @Query("spAddress") spAddress?: string,
  ): Promise<TriggerRetrievalResponseDto> {
    this.logger.log(`GET /api/dev/retrieval?dealId=${dealId}&spAddress=${spAddress}`);
    return this.devToolsService.triggerRetrieval(dealId, spAddress);
  }
}
