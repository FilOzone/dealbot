import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DatabaseModule } from "../database/database.module.js";
import { Deal } from "../database/entities/deal.entity.js";
import { Retrieval } from "../database/entities/retrieval.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { HttpClientModule } from "../http-client/http-client.module.js";
import { MetricsModule } from "../metrics/metrics.module.js";
import { RetrievalAddonsModule } from "../retrieval-addons/retrieval-addons.module.js";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { RetrievalService } from "./retrieval.service.js";

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([Deal, Retrieval, StorageProvider]),
    HttpClientModule,
    MetricsModule,
    WalletSdkModule,
    RetrievalAddonsModule,
  ],
  providers: [RetrievalService],
  exports: [RetrievalService],
})
export class RetrievalModule {}
