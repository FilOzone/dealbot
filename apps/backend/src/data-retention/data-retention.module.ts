import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DataRetentionBaseline } from "../database/entities/data-retention-baseline.entity.js";
import { PdpSubgraphModule } from "../pdp-subgraph/pdp-subgraph.module.js";
import { ProvidersModule } from "../providers/providers.module.js";
import { DataRetentionService } from "./data-retention.service.js";

@Module({
  imports: [ProvidersModule, PdpSubgraphModule, TypeOrmModule.forFeature([DataRetentionBaseline])],
  providers: [DataRetentionService],
  exports: [DataRetentionService],
})
export class DataRetentionModule {}
