import { Module } from "@nestjs/common";
import { SubgraphModule } from "../subgraph/subgraph.module.js";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { ActiveDataSetsCollector } from "./active-datasets.collector.js";
import { MetricsPrometheusModule } from "./metrics-prometheus.module.js";

/** API-only background collection of the shared Dealbot dataset inventory. */
@Module({
  imports: [MetricsPrometheusModule, SubgraphModule, WalletSdkModule],
  providers: [ActiveDataSetsCollector],
})
export class ActiveDataSetsModule {}
