import { Module } from "@nestjs/common";
import { RetrievalService } from "./retrieval.service.js";
import { InfrastructureModule } from "../infrastructure/infrastructure.module.js";
import { MetricsModule } from "../metrics/metrics.module.js";

@Module({
  imports: [InfrastructureModule, MetricsModule],
  providers: [RetrievalService],
  exports: [RetrievalService],
})
export class RetrievalModule {}
