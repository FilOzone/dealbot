import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { HttpClientModule } from "../http-client/http-client.module.js";
import { AlertService } from "./alert.service.js";
import { WalletSdkService } from "./wallet-sdk.service.js";

@Module({
  imports: [TypeOrmModule.forFeature([StorageProvider]), HttpClientModule],
  providers: [WalletSdkService, AlertService],
  exports: [WalletSdkService, AlertService],
})
export class WalletSdkModule {}
