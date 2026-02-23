import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { StorageProvider } from "src/database/entities/storage-provider.entity.js";
import { PdpSubgraphModule } from "../pdp-subgraph/pdp-subgraph.module.js";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { DataRetentionService } from "./data-retention.service.js";

@Module({
  imports: [WalletSdkModule, PdpSubgraphModule, TypeOrmModule.forFeature([StorageProvider])],
  providers: [DataRetentionService],
  exports: [DataRetentionService],
})
export class DataRetentionModule {}
