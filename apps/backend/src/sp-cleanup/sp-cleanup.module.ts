import { Module } from "@nestjs/common";
import { MetricsPrometheusModule } from "../metrics-prometheus/metrics-prometheus.module.js";
import { ProvidersModule } from "../providers/providers.module.js";
import { SubgraphModule } from "../subgraph/subgraph.module.js";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { SpCleanupService } from "./sp-cleanup.service.js";

@Module({
  imports: [WalletSdkModule, ProvidersModule, MetricsPrometheusModule, SubgraphModule],
  providers: [SpCleanupService],
  exports: [SpCleanupService],
})
export class SpCleanupModule {}
