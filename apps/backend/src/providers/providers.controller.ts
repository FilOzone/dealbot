import { Controller, DefaultValuePipe, Get, Logger, ParseIntPipe, Query } from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ProvidersService } from "./providers.service.js";

/**
 * Public API for storage provider discovery and version info.
 */
@ApiTags("Providers")
@Controller("api/v1/providers")
export class ProvidersController {
  private readonly logger = new Logger(ProvidersController.name);

  constructor(private readonly providersService: ProvidersService) {}

  /**
   * List all storage providers with their details.
   */
  @Get()
  @ApiOperation({
    summary: "List storage providers",
    description: "Get a paginated list of storage providers",
  })
  @ApiQuery({
    name: "limit",
    required: false,
    type: Number,
    description: "Number of results per page (default: 20)",
  })
  @ApiQuery({
    name: "offset",
    required: false,
    type: Number,
    description: "Pagination offset (default: 0)",
  })
  @ApiResponse({
    status: 200,
    description: "List of providers",
  })
  async listProviders(
    @Query("limit", new DefaultValuePipe(20), ParseIntPipe) limit?: number,
    @Query("offset", new DefaultValuePipe(0), ParseIntPipe) offset?: number,
  ) {
    this.logger.debug(`Listing providers: limit=${limit}, offset=${offset}`);

    const { providers, total } = await this.providersService.getProvidersList({
      limit,
      offset,
    });

    return {
      providers: providers.map((p) => ({
        ...p,
        ...(p.providerId != null ? { providerId: p.providerId.toString() } : {}),
      })),
      total,
      count: providers.length,
      offset: offset || 0,
      limit: limit || 20,
    };
  }
}
