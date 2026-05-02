import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Deal } from "../database/entities/deal.entity.js";
import { DealModule } from "../deal/deal.module.js";
import { RetrievalModule } from "../retrieval/retrieval.module.js";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { DevToolsController } from "./dev-tools.controller.js";
import { DevToolsService } from "./dev-tools.service.js";

@Module({
  imports: [TypeOrmModule.forFeature([Deal]), WalletSdkModule, DealModule, RetrievalModule],
  controllers: [DevToolsController],
  providers: [DevToolsService],
})
export class DevToolsModule {}
