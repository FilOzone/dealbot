import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DatabaseModule } from "../database/database.module.js";
import { Deal } from "../database/entities/deal.entity.js";
import { Retrieval } from "../database/entities/retrieval.entity.js";
import { DatasetLivenessModule } from "../dataset-liveness/dataset-liveness.module.js";
import { HttpClientModule } from "../http-client/http-client.module.js";
import { IpniModule } from "../ipni/ipni.module.js";
import { ProvidersModule } from "../providers/providers.module.js";
import { RetrievalAddonsModule } from "../retrieval-addons/retrieval-addons.module.js";
import { RetrievalService } from "./retrieval.service.js";

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([Deal, Retrieval]),
    ProvidersModule,
    HttpClientModule,
    IpniModule,
    RetrievalAddonsModule,
    DatasetLivenessModule,
  ],
  providers: [RetrievalService],
  exports: [RetrievalService],
})
export class RetrievalModule {}
