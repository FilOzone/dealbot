import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DatabaseModule } from "../database/database.module.js";
import { JobScheduleState } from "../database/entities/job-schedule-state.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { DealModule } from "../deal/deal.module.js";
import { MetricsModule } from "../metrics/metrics.module.js";
import { RetrievalModule } from "../retrieval/retrieval.module.js";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { JobsService } from "./jobs.service.js";

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([StorageProvider, JobScheduleState]),
    DealModule,
    RetrievalModule,
    MetricsModule,
    WalletSdkModule,
  ],
  providers: [JobsService],
})
export class JobsModule {}
