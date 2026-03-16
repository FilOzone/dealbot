import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type IBlockchainConfig, type IConfig, IJobsConfig } from "./config/app.config.js";

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
    const blockchain = this.configService.get<IBlockchainConfig>("blockchain");
    const jobs = this.configService.get<IJobsConfig>("jobs");

    return {
      network: blockchain.network,
      jobs: {
        dealsPerSpPerHour: jobs.dealsPerSpPerHour,
        dataSetCreationsPerSpPerHour: jobs.dataSetCreationsPerSpPerHour,
        retrievalsPerSpPerHour: jobs.retrievalsPerSpPerHour,
      },
    };
  }
}
