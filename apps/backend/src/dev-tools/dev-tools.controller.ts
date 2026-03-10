import { Controller, Get, Logger, Param, Query, UsePipes, ValidationPipe } from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { DevToolsService } from "./dev-tools.service.js";
import { CreateDealsAllResponseDto } from "./dto/create-deals-all.dto.js";
import { TriggerDealQueryDto, TriggerDealResponseDto } from "./dto/trigger-deal.dto.js";
import { TriggerRetrievalQueryDto, TriggerRetrievalResponseDto } from "./dto/trigger-retrieval.dto.js";

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

  @Get("deals/create-all")
  @ApiOperation({
    summary: "Create deals for all providers (scheduler flow)",
    description:
      "Loads providers, then runs createDealsForAllProviders. Same logic as the scheduled deal-creation job. Blocks until complete.",
  })
  @ApiResponse({
    status: 200,
    description: "Deals created for all registered providers",
    type: CreateDealsAllResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: "No registered providers found",
  })
  @ApiResponse({
    status: 409,
    description: "Deal creation for all providers already in progress",
  })
  async createDealsForAllProviders(): Promise<CreateDealsAllResponseDto> {
    this.logger.log("GET /api/dev/deals/create-all");
    return this.devToolsService.triggerDealsForAllProviders();
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
    description: "Deal accepted - use /api/dev/deals/:dealId to check progress",
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
  @UsePipes(new ValidationPipe({ transform: true }))
  async triggerDeal(@Query() query: TriggerDealQueryDto): Promise<TriggerDealResponseDto> {
    this.logger.log(`GET /api/dev/deal?spAddress=${query.spAddress}`);
    return this.devToolsService.triggerDeal(query.spAddress);
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

  @Get("retrieval")
  @ApiOperation({ summary: "Trigger retrieval for a deal" })
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
  @UsePipes(new ValidationPipe({ transform: true }))
  async triggerRetrieval(@Query() query: TriggerRetrievalQueryDto): Promise<TriggerRetrievalResponseDto> {
    this.logger.log(`GET /api/dev/retrieval?dealId=${query.dealId}&spAddress=${query.spAddress}`);
    return this.devToolsService.triggerRetrieval(query.dealId, query.spAddress);
  }
}
