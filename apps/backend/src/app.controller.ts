import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Network } from "./common/types.js";
import type { IConfig, INetworksConfig } from "./config/types.js";

@Controller("api")
export class AppController {
  constructor(private readonly configService: ConfigService<IConfig, true>) {}

  /**
   * Health check endpoint
   * Returns the current status
   */
  @Get("health")
  getHealth() {
    return { status: "ok" };
  }

  /**
   * Get dealbot infrastructure configuration
   * Returns network, job rates (per-hour), and other infrastructure details
   */
  @Get("config")
  getConfig() {
    const activeNetworks = this.configService.get<Network[]>("activeNetworks");
    const networks = this.configService.get<INetworksConfig>("networks");

    return {
      networks: activeNetworks.map((n) => ({
        network: n,
        dealsPerSpPerHour: networks[n].dealsPerSpPerHour,
        dataSetCreationsPerSpPerHour: networks[n].dataSetCreationsPerSpPerHour,
        retrievalsPerSpPerHour: networks[n].retrievalsPerSpPerHour,
        dataRetentionPollIntervalSeconds: networks[n].dataRetentionPollIntervalSeconds,
        providersRefreshIntervalSeconds: networks[n].providersRefreshIntervalSeconds,
      })),
    };
  }
}
