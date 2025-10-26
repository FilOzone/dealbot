import { Module } from "@nestjs/common";
import { DealService } from "./deal.service.js";
import { DataSourceModule } from "../dataSource/dataSource.module.js";
import { MetricsModule } from "../metrics/metrics.module.js";
import { ConfigModule } from "@nestjs/config";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { DealAddonsModule } from "../deal-addons/deal-addons.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { Deal } from "../database/entities/deal.entity.js";
import { Retrieval } from "../database/entities/retrieval.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { TypeOrmModule } from "@nestjs/typeorm";

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    TypeOrmModule.forFeature([Deal, Retrieval, StorageProvider]),
    DataSourceModule,
    MetricsModule,
    WalletSdkModule,
    DealAddonsModule,
  ],
  providers: [DealService],
  exports: [DealService],
})
export class DealModule {}
