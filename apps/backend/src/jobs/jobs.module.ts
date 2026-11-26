import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DataRetentionModule } from "../data-retention/data-retention.module.js";
import { DataSetLifecycleModule } from "../data-set-lifecycle/data-set-lifecycle.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { JobScheduleState } from "../database/entities/job-schedule-state.entity.js";
import { DealModule } from "../deal/deal.module.js";
import { PieceCleanupModule } from "../piece-cleanup/piece-cleanup.module.js";
import { ProvidersModule } from "../providers/providers.module.js";
import { PullCheckModule } from "../pull-check/pull-check.module.js";
import { RetrievalModule } from "../retrieval/retrieval.module.js";
import { SampledRetrievalModule } from "../sampled-retrieval/sampled-retrieval.module.js";
import { SpCleanupModule } from "../sp-cleanup/sp-cleanup.module.js";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { JobsService } from "./jobs.service.js";
import { JobScheduleRepository } from "./repositories/job-schedule.repository.js";

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([JobScheduleState]),
    DataSetLifecycleModule,
    DealModule,
    RetrievalModule,
    WalletSdkModule,
    ProvidersModule,
    DataRetentionModule,
    PieceCleanupModule,
    PullCheckModule,
    SampledRetrievalModule,
    SpCleanupModule,
  ],
  providers: [JobsService, JobScheduleRepository],
})
export class JobsModule {}
