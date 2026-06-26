import { Module } from "@nestjs/common";
import { MetricsPrometheusModule } from "../metrics-prometheus/metrics-prometheus.module.js";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { DataSetLifecycleService } from "./data-set-lifecycle.service.js";

@Module({
  imports: [WalletSdkModule, MetricsPrometheusModule],
  providers: [DataSetLifecycleService],
  exports: [DataSetLifecycleService],
})
export class DataSetLifecycleModule {}
