import { Injectable, Logger, Inject } from "@nestjs/common";
import { HttpClientService } from "../http-client/http-client.service.js";
import { ConfigService } from "@nestjs/config";
import type { IConfig, IAlertsConfig } from "../config/app.config.js";

type Json = Record<string, unknown>;

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);
  private readonly webhookUrl: string;

  constructor(
    private readonly httpClient: HttpClientService,
    private readonly configService: ConfigService<IConfig, true>
  ) {
    const alerts: IAlertsConfig = this.configService.get<IAlertsConfig>('alerts');
    this.webhookUrl = alerts?.webhookUrl;
  }

  async sendLowBalanceAlert(details: Json): Promise<void> {
    if (!this.webhookUrl) {
      this.logger.warn("Alert webhook URL not configured; skipping low balance alert", details);
      return;
    }
    const payload = { type: "low_balance", details };
    await this.postWithRetry(payload, "low_balance");
  }

  async sendFundResultAlert(details: Json): Promise<void> {
    if (!this.webhookUrl) {
      this.logger.warn("Alert webhook URL not configured; skipping fund result alert", details);
      return;
    }
    const payload = { type: "auto_fund_result", details };
    await this.postWithRetry(payload, "auto_fund_result");
  }

  private async postWithRetry(body: Json, context: string): Promise<void> {
    try {
      await this.httpClient.postJson(this.webhookUrl, body);
    } catch (err) {
      this.logger.warn(`Alert webhook failed (${context}); retrying once`, { error: String(err) });
      try {
        await this.httpClient.postJson(this.webhookUrl, body);
      } catch (err2) {
        this.logger.error(`Alert webhook failed after retry (${context})`, { error: String(err2) });
      }
    }
  }
}
