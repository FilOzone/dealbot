import { Module } from "@nestjs/common";
import { RetrievalController } from "./retrieval.controller";
import { RetrievalService } from "./retrieval.service";
import { InfrastructureModule } from "../infrastructure/infrastructure.module";

@Module({
  imports: [InfrastructureModule],
  controllers: [RetrievalController],
  providers: [RetrievalService],
  exports: [RetrievalService],
})
export class RetrievalModule {}
