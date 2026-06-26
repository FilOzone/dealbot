import { BadRequestException, Controller, DefaultValuePipe, Get, Logger, ParseIntPipe, Query } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { SUPPORTED_NETWORKS } from "../common/constants.js";
import type { Network } from "../common/types.js";
import type { IConfig } from "../config/index.js";
import { ProviderListResponseDto } from "./dto/provider-list-response.dto.js";
import { ProvidersService } from "./providers.service.js";

/**
 * Public API for storage provider discovery and version info.
 */
@ApiTags("Providers")
@Controller("api/v1/providers")
export class ProvidersController {
  private readonly logger = new Logger(ProvidersController.name);

  constructor(
    private readonly providersService: ProvidersService,
    private readonly configService: ConfigService<IConfig, true>,
  ) {}

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
  @ApiQuery({
    name: "network",
    required: false,
    enum: SUPPORTED_NETWORKS,
    description:
      "Filter by network. Must be an active network on this instance. When omitted, providers from all active networks are returned.",
  })
  @ApiResponse({
    status: 200,
    description: "List of providers",
    type: ProviderListResponseDto,
  })
  async listProviders(
    @Query("limit", new DefaultValuePipe(20), ParseIntPipe) limit?: number,
    @Query("offset", new DefaultValuePipe(0), ParseIntPipe) offset?: number,
    @Query("network") network?: string,
  ): Promise<ProviderListResponseDto> {
    // Validate against active networks, not SUPPORTED_NETWORKS: providers are only
    // synced/refreshed for active networks, so a supported-but-inactive network has
    // no (or stale) rows and no blocklist config. Rejecting here gives an honest 400
    // instead of a misleading `200 []`.
    if (network !== undefined) {
      const activeNetworks = this.configService.get("activeNetworks", { infer: true });
      if (!activeNetworks.includes(network as Network)) {
        throw new BadRequestException(
          `Invalid network "${network}". Must be an active network: ${activeNetworks.join(", ")}`,
        );
      }
    }

    this.logger.debug(`Listing providers: limit=${limit}, offset=${offset}, network=${network ?? "all"}`);

    const { providers, total } = await this.providersService.getProvidersList({
      limit,
      offset,
      network: network as Network | undefined,
    });

    return {
      providers: providers.map((p) => {
        const { deals, providerId, ...rest } = p;
        return {
          ...rest,
          ...(providerId != null ? { providerId: providerId.toString() } : {}),
        };
      }),
      total,
      count: providers.length,
      offset: offset ?? 0,
      limit: limit ?? 20,
    };
  }
}
