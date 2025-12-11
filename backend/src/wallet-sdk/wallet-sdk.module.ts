import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { WalletSdkService } from "./wallet-sdk.service.js";

@Module({
  imports: [TypeOrmModule.forFeature([StorageProvider])],
  providers: [WalletSdkService],
  exports: [WalletSdkService],
})
export class WalletSdkModule {}
