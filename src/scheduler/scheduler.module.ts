import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { SchedulerService } from "./scheduler.service.js";
import { DealModule } from "../deal/deal.module.js";
import { RetrievalModule } from "../retrieval/retrieval.module.js";

@Module({
  imports: [ConfigModule, DealModule, RetrievalModule, ScheduleModule.forRoot()],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
