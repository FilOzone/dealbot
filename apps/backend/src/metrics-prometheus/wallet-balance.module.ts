import { Module } from "@nestjs/common";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { MetricsPrometheusModule } from "./metrics-prometheus.module.js";
import { WalletBalanceCollector } from "./wallet-balance.collector.js";

/** API-only collection of balances for the shared Dealbot wallet. */
@Module({
  imports: [MetricsPrometheusModule, WalletSdkModule],
  providers: [WalletBalanceCollector],
})
export class WalletBalanceModule {}
