import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Deal } from "../database/entities/deal.entity.js";
import { DealModule } from "../deal/deal.module.js";
import { ProvidersModule } from "../providers/providers.module.js";
import { RetrievalModule } from "../retrieval/retrieval.module.js";
import { DevToolsController } from "./dev-tools.controller.js";
import { DevToolsService } from "./dev-tools.service.js";

@Module({
  imports: [TypeOrmModule.forFeature([Deal]), ProvidersModule, DealModule, RetrievalModule],
  controllers: [DevToolsController],
  providers: [DevToolsService],
})
export class DevToolsModule {}
