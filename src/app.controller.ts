import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { VersionService } from "./common/version.service.js";
import type { IBlockchainConfig, IConfig, ISchedulingConfig } from "./config/app.config.js";

@Controller("api")
export class AppController {
  constructor(
    private readonly configService: ConfigService<IConfig, true>,
    private readonly versionService: VersionService,
  ) {}

  /**
   * Health check endpoint
   * Returns the current status
   */
  @Get("health")
  getHealth() {
    return { status: "ok" };
  }

  /**
   * Get version information
   * Returns version, commit hash, branch, and build time
   */
  @Get("version")
  getVersion() {
    return this.versionService.getVersionInfo();
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
