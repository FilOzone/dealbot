import { Module } from "@nestjs/common";
import { PdpSubgraphModule } from "../pdp-subgraph/pdp-subgraph.module.js";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { DataRetentionService } from "./data-retention.service.js";

@Module({
  imports: [WalletSdkModule, PdpSubgraphModule],
  providers: [DataRetentionService],
  exports: [DataRetentionService],
})
export class DataRetentionModule {}
