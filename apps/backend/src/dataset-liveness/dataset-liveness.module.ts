import { Module } from "@nestjs/common";
import { ProvidersModule } from "../providers/providers.module.js";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { DatasetLivenessService } from "./dataset-liveness.service.js";

@Module({
  imports: [WalletSdkModule, ProvidersModule],
  providers: [DatasetLivenessService],
  exports: [DatasetLivenessService],
})
export class DatasetLivenessModule {}
