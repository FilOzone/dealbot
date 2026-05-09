import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DatabaseModule } from "../database/database.module.js";
import { PullPiece } from "../database/entities/pull-piece.entity.js";
import { DataSourceModule } from "../dataSource/dataSource.module.js";
import { HttpClientModule } from "../http-client/http-client.module.js";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { PullCheckService } from "./pull-check.service.js";
import { PieceSourceController } from "./pull-piece.controller.js";
import { PullPieceRepository } from "./pull-piece.repository.js";

const runMode = process.env.DEALBOT_RUN_MODE?.toLowerCase() || "both";
const isWorkerOnly = runMode === "worker";

@Module({
  imports: [DatabaseModule, TypeOrmModule.forFeature([PullPiece]), WalletSdkModule, DataSourceModule, HttpClientModule],
  controllers: isWorkerOnly ? [] : [PieceSourceController],
  providers: [PullCheckService, PullPieceRepository],
  exports: [PullCheckService, PullPieceRepository],
})
export class PullCheckModule {}
