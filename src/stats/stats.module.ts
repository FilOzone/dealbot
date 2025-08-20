import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { StatsController } from "./stats.controller";
import { OverallStatsService } from "./stats.service";
import { StorageProviderEntity } from "../infrastructure/database/entities/storage-provider.entity";
import { DailyMetricsEntity } from "../infrastructure/database/entities/daily-metrics.entity";

@Module({
  imports: [TypeOrmModule.forFeature([StorageProviderEntity, DailyMetricsEntity])],
  controllers: [StatsController],
  providers: [OverallStatsService],
  exports: [OverallStatsService],
})
export class StatsModule {}
