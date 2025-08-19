import { Module } from "@nestjs/common";
import { DealService } from "./deal.service";
import { InfrastructureModule } from "../infrastructure/infrastructure.module";
import { DataSourceModule } from "../dataSource/dataSource.module";
import { ConfigModule } from "@nestjs/config";

@Module({
  imports: [ConfigModule, DataSourceModule, InfrastructureModule],
  providers: [DealService],
  exports: [DealService],
})
export class DealModule {}
