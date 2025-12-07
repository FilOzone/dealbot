import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { IAlertsConfig, IConfig } from "../config/app.config.js";
import { HttpClientService } from "../http-client/http-client.service.js";

type Json = Record<string, unknown>;

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);
  private readonly webhookUrl: string;
  private lastAlertTime: Record<string, number> = {}; // Track last alert time per type
  private readonly alertThrottleMs = 60000; // Don't send same alert type more than once per minute

  constructor(
    private readonly httpClient: HttpClientService,
    private readonly configService: ConfigService<IConfig, true>,
  ) {
    const alerts: IAlertsConfig = this.configService.get<IAlertsConfig>("alerts");
    this.webhookUrl = alerts?.webhookUrl;
  }

  async sendLowBalanceAlert(details: Json): Promise<void> {
    if (!this.webhookUrl) {
      this.logger.warn("Alert webhook URL not configured; skipping low balance alert", details);
      return;
    }

    // Throttle: don't send the same alert type more than once per minute
    const now = Date.now();
    if (this.lastAlertTime.low_balance && now - this.lastAlertTime.low_balance < this.alertThrottleMs) {
      this.logger.debug(
        `Skipping low_balance alert (throttled); last sent ${now - this.lastAlertTime.low_balance}ms ago`,
      );
      return;
    }

    this.lastAlertTime.low_balance = now;
    const payload = this.formatAlertPayload("low_balance", details);
    await this.postWithRetry(payload, "low_balance");
  }

  async sendFundResultAlert(details: Json): Promise<void> {
    if (!this.webhookUrl) {
      this.logger.warn("Alert webhook URL not configured; skipping fund result alert", details);
      return;
    }

    // Don't throttle fund result alerts - these are important one-time events
    const payload = this.formatAlertPayload("auto_fund_result", details);
    await this.postWithRetry(payload, "auto_fund_result");
  }

  /**
   * Format alert payload for webhook compatibility
   * Supports both generic webhooks and Slack-compatible format
   */
  private formatAlertPayload(type: string, details: Json): Json {
    // Check if this is a Slack webhook URL
    const isSlackWebhook = this.webhookUrl.includes("hooks.slack.com");

    if (isSlackWebhook) {
      return this.formatSlackMessage(type, details);
    }

    // Generic webhook format (for local debug endpoint, Discord, etc.)
    return { type, details };
  }

  /**
   * Format message for Slack webhook
   * https://api.slack.com/messaging/webhooks
   */
  private formatSlackMessage(type: string, details: Json): Json {
    const timestamp = new Date().toISOString();
    let text = "";

    if (type === "low_balance") {
      const reason = details.reason || "unknown";
      text = `⚠️ *Low Balance Alert*\n`;
      text += `• Reason: \`${reason}\`\n`;
      text += `• Available Funds: \`${details.availableFunds || "N/A"}\`\n`;
      text += `• Threshold: \`${details.threshold || "N/A"}\`\n`;
      if (details.filBalance) {
        text += `• FIL Balance: \`${details.filBalance}\`\n`;
      }
      text += `• Time: ${timestamp}`;
    } else if (type === "auto_fund_result") {
      const status = details.status as string;
      const icon = status === "success" ? "✅" : "❌";
      text = `${icon} *Auto-Fund ${status === "success" ? "Success" : "Failed"}*\n`;
      text += `• Deposit Amount: \`${details.depositAmount || "N/A"}\`\n`;
      if (status === "success") {
        text += `• TX Hash: \`${details.txHash || "N/A"}\`\n`;
        text += `• Before: \`${details.availableFundsBefore || "N/A"}\`\n`;
        text += `• After: \`${details.availableFundsAfter || "N/A"}\`\n`;
      } else {
        text += `• Available Funds: \`${details.availableFunds || "N/A"}\`\n`;
        text += `• Error: \`${details.error || "N/A"}\`\n`;
      }
      text += `• Time: ${timestamp}`;
    }

    // Simplified Slack payload - just text field
    // Slack webhooks require at minimum { "text": "message" }
    return { text };
  }

  private async postWithRetry(body: Json, context: string): Promise<void> {
    const maxRetries = 3;
    const initialDelayMs = 1000; // 1 second

    // Log payload for debugging
    this.logger.debug(`Sending ${context} alert to webhook`, {
      url: this.webhookUrl.replace(/\/services\/.*/, "/services/***"),
      payloadKeys: Object.keys(body),
    });

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.httpClient.postJson(this.webhookUrl, body);
        this.logger.log(`Alert webhook sent successfully (${context})`);
        return; // Success
      } catch (err) {
        const isLastAttempt = attempt === maxRetries - 1;
        const statusCode = this.extractStatusCode(err);

        if (isLastAttempt) {
          this.logger.error(
            `Alert webhook failed after ${maxRetries} attempts (${context}); giving up`,
            { error: String(err), statusCode },
          );
        } else {
          const delayMs = initialDelayMs * 2 ** attempt; // Exponential backoff: 1s, 2s, 4s
          this.logger.warn(
            `Alert webhook failed (${context}) on attempt ${attempt + 1}/${maxRetries}; retrying in ${delayMs}ms`,
            { error: String(err), statusCode },
          );
          await this.sleep(delayMs);
        }
      }
    }
  }

  private extractStatusCode(err: any): number | undefined {
    if (err?.response?.status) return err.response.status;
    if (err?.code) return Number.parseInt(String(err.code), 10);
    return undefined;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
