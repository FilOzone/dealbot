import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Deal } from "../database/entities/deal.entity.js";
import { ProvidersModule } from "../providers/providers.module.js";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { PieceCleanupService } from "./piece-cleanup.service.js";

@Module({
  imports: [TypeOrmModule.forFeature([Deal]), WalletSdkModule, ProvidersModule],
  providers: [PieceCleanupService],
  exports: [PieceCleanupService],
})
export class PieceCleanupModule {}
