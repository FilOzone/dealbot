import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { StatsController } from "./stats.controller.js";
import { StatsService } from "./stats.service.js";
import { StorageProviderEntity } from "../infrastructure/database/entities/storage-provider.entity.js";
import { DailyMetricsEntity } from "../infrastructure/database/entities/daily-metrics.entity.js";

@Module({
  imports: [TypeOrmModule.forFeature([StorageProviderEntity, DailyMetricsEntity])],
  controllers: [StatsController],
  providers: [StatsService],
  exports: [StatsService],
})
export class StatsModule {}
