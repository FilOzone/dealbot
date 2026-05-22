import { Module } from "@nestjs/common";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { DatasetLivenessService } from "./dataset-liveness.service.js";

@Module({
  imports: [WalletSdkModule],
  providers: [DatasetLivenessService],
  exports: [DatasetLivenessService],
})
export class DatasetLivenessModule {}
