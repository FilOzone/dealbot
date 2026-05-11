import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DatabaseModule } from "../database/database.module.js";
import { PullPiece } from "../database/entities/pull-piece.entity.js";
import { DataSourceModule } from "../dataSource/dataSource.module.js";
import { HttpClientModule } from "../http-client/http-client.module.js";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { PullCheckService } from "./pull-check.service.js";
import { PieceSourceController } from "./pull-piece.controller.js";
import { PullPieceRepository } from "./pull-piece.repository.js";
import { PullPieceStreamTracker } from "./pull-piece-stream-tracker.service.js";

const runMode = process.env.DEALBOT_RUN_MODE?.toLowerCase() || "both";
const isWorkerOnly = runMode === "worker";

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: "pull-piece",
        ttl: 60_000, // 1 minute window
        limit: 10, // 10 requests per IP per window
      },
    ]),
    TypeOrmModule.forFeature([PullPiece]),
    DatabaseModule,
    WalletSdkModule,
    DataSourceModule,
    HttpClientModule,
  ],
  controllers: isWorkerOnly ? [] : [PieceSourceController],
  providers: [PullCheckService, PullPieceRepository, PullPieceStreamTracker],
  exports: [PullCheckService, PullPieceRepository],
})
export class PullCheckModule {}
