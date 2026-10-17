import { Module } from "@nestjs/common";
import { ProvidersModule } from "../providers/providers.module.js";
import { WalletSdkService } from "./wallet-sdk.service.js";

@Module({
  imports: [ProvidersModule],
  providers: [WalletSdkService],
  exports: [WalletSdkService],
})
export class WalletSdkModule {}
