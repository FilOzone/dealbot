import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { DataSourceModule } from "../dataSource/dataSource.module.js";
import { HttpClientModule } from "../http-client/http-client.module.js";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { HostedPieceRegistry } from "./hosted-piece.registry.js";
import { PieceSourceController } from "./piece-source.controller.js";
import { PullCheckService } from "./pull-check.service.js";

@Module({
  imports: [DatabaseModule, WalletSdkModule, DataSourceModule, HttpClientModule],
  controllers: [PieceSourceController],
  providers: [PullCheckService, HostedPieceRegistry],
  exports: [PullCheckService, HostedPieceRegistry],
})
export class PullCheckModule {}
