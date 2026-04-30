import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DatabaseModule } from "../database/database.module.js";
import { PullCheck } from "../database/entities/pull-check.entity.js";
import { DataSourceModule } from "../dataSource/dataSource.module.js";
import { DealModule } from "../deal/deal.module.js";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { HostedPieceRegistry } from "./hosted-piece.registry.js";
import { PieceSourceController } from "./piece-source.controller.js";
import { PullCheckService } from "./pull-check.service.js";

@Module({
  imports: [DatabaseModule, TypeOrmModule.forFeature([PullCheck]), WalletSdkModule, DataSourceModule, DealModule],
  controllers: [PieceSourceController],
  providers: [PullCheckService, HostedPieceRegistry],
  exports: [PullCheckService, HostedPieceRegistry],
})
export class PullCheckModule {}
