import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { IBlockchainConfig, IConfig, ISchedulingConfig } from "./config/app.config.js";

interface IVersionInfo {
  version: string;
  commit: string;
  commitShort: string;
  branch: string;
  buildTime: string;
}

@Controller("api")
export class AppController {
  private versionInfo: IVersionInfo | null = null;

  constructor(private readonly configService: ConfigService<IConfig, true>) {
    this.loadVersionInfo();
  }

  /**
   * Load version information from version.json
   */
  private loadVersionInfo() {
    try {
      const versionPath = join(process.cwd(), "dist", "version.json");
      const versionData = readFileSync(versionPath, "utf-8");
      this.versionInfo = JSON.parse(versionData);
    } catch (error) {
      console.warn("Warning: Could not load version info:", error);
      this.versionInfo = {
        version: "unknown",
        commit: "unknown",
        commitShort: "unknown",
        branch: "unknown",
        buildTime: new Date().toISOString(),
      };
    }
  }

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
    return this.versionInfo;
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
