import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { SchedulerService } from "./scheduler.service";
import { DealModule } from "../deal/deal.module";
import { RetrievalModule } from "../retrieval/retrieval.module";

@Module({
  imports: [ConfigModule, DealModule, RetrievalModule, ScheduleModule.forRoot()],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
