import { Module } from "@nestjs/common";
import { DealService } from "./deal.service.js";
import { DataSourceModule } from "../dataSource/dataSource.module.js";
import { InfrastructureModule } from "../infrastructure/infrastructure.module.js";
import { MetricsModule } from "../metrics/metrics.module.js";
import { ConfigModule } from "@nestjs/config";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";

@Module({
  imports: [ConfigModule, DataSourceModule, InfrastructureModule, MetricsModule, WalletSdkModule],
  providers: [DealService],
  exports: [DealService],
})
export class DealModule {}
