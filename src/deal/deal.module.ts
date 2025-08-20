import { Module } from "@nestjs/common";
import { DealService } from "./deal.service";
import { DataSourceModule } from "../dataSource/dataSource.module";
import { InfrastructureModule } from "../infrastructure/infrastructure.module";
import { MetricsModule } from "../metrics/metrics.module";
import { ConfigModule } from "@nestjs/config";

@Module({
  imports: [ConfigModule, DataSourceModule, InfrastructureModule, MetricsModule],
  providers: [DealService],
  exports: [DealService],
})
export class DealModule {}
