import { Module } from "@nestjs/common";
import { ProvidersModule } from "../providers/providers.module.js";
import { SubgraphModule } from "../subgraph/subgraph.module.js";
import { ActiveDataSetsCollector } from "./active-datasets.collector.js";
import { MetricsPrometheusModule } from "./metrics-prometheus.module.js";

/** API-only background collection of the shared Dealbot dataset inventory. */
@Module({
  imports: [MetricsPrometheusModule, SubgraphModule, ProvidersModule],
  providers: [ActiveDataSetsCollector],
})
export class ActiveDataSetsModule {}
