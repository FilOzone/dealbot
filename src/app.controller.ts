import { Body, Controller, Get, Logger, Post } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { IBlockchainConfig, IConfig, ISchedulingConfig } from "./config/app.config.js";

@Controller("api")
export class AppController {
  private readonly logger = new Logger(AppController.name);

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

  /**
   * Debug webhook endpoint for testing alert service locally
   * 
   * This endpoint is useful for development and testing without requiring
   * external webhook services (e.g., webhook.site, Discord, Slack).
   * 
   * Usage:
   * Set in .env: ALERT_WEBHOOK_URL=http://localhost:8080/api/debug/webhook
   * 
   * The endpoint logs all received alerts and returns a success response,
   * allowing you to verify alert payloads without rate limits.
   * 
   * Note: Only intended for development/testing environments.
   */
  @Post("debug/webhook")
  debugWebhook(@Body() body: any) {
    this.logger.log("Alert webhook received", {
      type: body?.type,
      timestamp: new Date().toISOString(),
      details: body?.details,
    });
    return { success: true, receivedAt: new Date().toISOString() };
  }
}
