import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import type { Gauge } from "prom-client";
import { toStructuredError } from "../common/logging.js";
import type { IConfig } from "../config/app.config.js";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";

const CACHE_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class WalletBalanceCollector implements OnModuleInit {
  private readonly logger = new Logger(WalletBalanceCollector.name);
  private cachedAt = 0;

  private refreshPromise: Promise<void> | null = null;
  private errorCooldownMs = 60 * 1000;

  constructor(
    private readonly configService: ConfigService<IConfig, true>,
    private readonly walletSdkService: WalletSdkService,
    @InjectMetric("wallet_balance")
    private readonly walletBalanceGauge: Gauge,
  ) {}

  onModuleInit(): void {
    const gauge = this.walletBalanceGauge as Gauge & { collect: () => Promise<void> };
    gauge.collect = async () => {
      if (process.env.DEALBOT_DISABLE_CHAIN === "true") {
        return;
      }
      const now = Date.now();
      if (now - this.cachedAt < CACHE_TTL_MS) {
        return;
      }

      if (this.refreshPromise) {
        await this.refreshPromise;
        return;
      }

      this.refreshPromise = (async () => {
        try {
          const { usdfc, fil } = await this.walletSdkService.getWalletBalances();
          const walletShort = this.configService.get("blockchain").walletAddress.slice(0, 8);
          this.walletBalanceGauge.set({ currency: "USDFC", wallet: walletShort }, Number(usdfc));
          this.walletBalanceGauge.set({ currency: "FIL", wallet: walletShort }, Number(fil));
          this.cachedAt = Date.now();
        } catch (error) {
          this.logger.warn({
            event: "wallet_balance_collect_failed",
            message: "Failed to fetch wallet balances during scrape",
            error: toStructuredError(error),
          });
          this.cachedAt = Date.now() - CACHE_TTL_MS + this.errorCooldownMs;
        } finally {
          this.refreshPromise = null;
        }
      })();

      await this.refreshPromise;
    };
  }
}
