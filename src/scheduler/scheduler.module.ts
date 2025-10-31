import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { DealModule } from "../deal/deal.module.js";
import { RetrievalModule } from "../retrieval/retrieval.module.js";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { SchedulerService } from "./scheduler.service.js";

@Module({
  imports: [DealModule, RetrievalModule, WalletSdkModule, ScheduleModule.forRoot()],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
