import { Module } from "@nestjs/common";
import { RetrievalService } from "./retrieval.service";
import { InfrastructureModule } from "../infrastructure/infrastructure.module";
import { MetricsModule } from "../metrics/metrics.module";

@Module({
  imports: [InfrastructureModule, MetricsModule],
  providers: [RetrievalService],
  exports: [RetrievalService],
})
export class RetrievalModule {}
