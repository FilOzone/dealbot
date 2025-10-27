import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { IBlockchainConfig, IConfig, ISchedulingConfig } from "./config/app.config.js";

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
   * Returns network, scheduling frequencies, and other infrastructure details
   */
  @Get("config")
  getConfig() {
    const scheduling = this.configService.get<ISchedulingConfig>("scheduling");
    const blockchain = this.configService.get<IBlockchainConfig>("blockchain");

    return {
      network: blockchain.network,
      scheduling: {
        dealIntervalSeconds: scheduling.dealIntervalSeconds,
        retrievalIntervalSeconds: scheduling.retrievalIntervalSeconds,
      },
    };
  }
}
