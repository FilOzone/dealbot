import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
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

  /**
   * Get Curio versions for multiple storage providers in batch.
   */
  @Post("versions/batch")
  @HttpCode(200)
  @ApiOperation({
    summary: "Get Curio versions for multiple providers (batch)",
    description: "Fetch Curio versions for multiple storage providers in a single request",
  })
  @ApiBody({
    description: "Array of storage provider addresses",
    schema: {
      type: "object",
      properties: {
        addresses: {
          type: "array",
          items: { type: "string" },
          example: ["f01234", "f05678", "f09012"],
        },
      },
      required: ["addresses"],
    },
  })
  @ApiResponse({
    status: 200,
    description: "Map of provider addresses to their Curio versions",
    schema: {
      type: "object",
      additionalProperties: { type: "string" },
      example: {
        f01234: "1.27.0 (76330a87)",
        f05678: "1.26.5 (abc12345)",
      },
    },
  })
  @ApiResponse({ status: 400, description: "Invalid or empty addresses array" })
  async getProviderVersionsBatch(@Body("addresses") addresses: string[]): Promise<Record<string, string>> {
    if (!addresses || !Array.isArray(addresses) || addresses.length === 0) {
      throw new BadRequestException("Addresses array is required and cannot be empty");
    }

    const addressList = addresses.map((addr) => addr.trim()).filter(Boolean);

    if (addressList.length === 0) {
      throw new BadRequestException("At least one valid provider address is required");
    }

    this.logger.debug(`Fetching Curio versions for ${addressList.length} providers (batch)`);

    return this.providersService.getProviderCurioVersionsBatch(addressList);
  }

  /**
   * Get Curio version from a storage provider's service URL.
   */
  @Get(":spAddress/version")
  @ApiOperation({
    summary: "Get provider Curio version",
    description: "Fetch the Curio version from a storage provider's service endpoint (proxied through backend)",
  })
  @ApiParam({ name: "spAddress", description: "Storage provider address" })
  @ApiResponse({
    status: 200,
    description: "Curio version string",
    type: String,
  })
  @ApiResponse({
    status: 404,
    description: "Provider not found or version endpoint unavailable",
  })
  async getProviderVersion(@Param("spAddress") spAddress: string): Promise<string> {
    this.logger.debug(`Fetching Curio version for provider: ${spAddress}`);
    return this.providersService.getProviderCurioVersion(spAddress);
  }
}
