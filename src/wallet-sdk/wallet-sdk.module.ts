import { Module } from "@nestjs/common";
import { WalletSdkService } from "./wallet-sdk.service.js";

@Module({
  providers: [WalletSdkService],
  exports: [WalletSdkService],
})
export class WalletSdkModule {}
