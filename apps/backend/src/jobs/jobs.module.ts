import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DataRetentionModule } from "../data-retention/data-retention.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { JobScheduleState } from "../database/entities/job-schedule-state.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { DealModule } from "../deal/deal.module.js";
import { PieceCleanupModule } from "../piece-cleanup/piece-cleanup.module.js";
import { RetrievalModule } from "../retrieval/retrieval.module.js";
import { RetrievalAnonModule } from "../retrieval-anon/retrieval-anon.module.js";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { JobsService } from "./jobs.service.js";
import { JobScheduleRepository } from "./repositories/job-schedule.repository.js";

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([StorageProvider, JobScheduleState]),
    DealModule,
    RetrievalModule,
    RetrievalAnonModule,
    WalletSdkModule,
    DataRetentionModule,
    PieceCleanupModule,
  ],
  providers: [JobsService, JobScheduleRepository],
})
export class JobsModule {}
