import { Module } from "@nestjs/common";
import { SubgraphService } from "./subgraph.service.js";

@Module({
  providers: [SubgraphService],
  exports: [SubgraphService],
})
export class SubgraphModule {}
