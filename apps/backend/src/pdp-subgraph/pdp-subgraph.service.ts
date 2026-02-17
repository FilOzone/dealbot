import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IBlockchainConfig, IConfig } from "src/config/app.config.js";
import { Queries } from "./queries.js";
import { type IProviderDataSetResponse, validateProviderDataSetResponse } from "./types.js";

@Injectable()
export class PDPSubgraphService {
  private readonly logger: Logger = new Logger(PDPSubgraphService.name);

  private readonly blockchainConfig: IBlockchainConfig;

  constructor(private readonly configService: ConfigService<IConfig, true>) {
    this.blockchainConfig = this.configService.get<IBlockchainConfig>("blockchain");
  }

  /**
   * Fetch providers with datasets from subgraph
   *
   * @param blockNumber - the block number
   */
  async fetchProvidersWithDatasets(blockNumber: number): Promise<IProviderDataSetResponse["providers"]> {
    const variables = {
      blockNumber: blockNumber.toString(),
    };

    try {
      const response = await fetch(this.blockchainConfig.pdpSubgraphEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: Queries.GET_PROVIDERS_WITH_DATASETS,
          variables,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = (await response.json()) as { data: unknown; errors?: unknown };

      if (result.errors) {
        throw new Error(
          `Failed to fetch providers with datasets: ${(result.errors as { message: string }[])?.[0]?.message}`,
        );
      }

      const validated = validateProviderDataSetResponse(result.data);

      return validated.providers;
    } catch (error) {
      this.logger.error(`Failed to fetch provider data from subgraph: `, error);
      throw new Error(`Failed to fetch provider data: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
}
