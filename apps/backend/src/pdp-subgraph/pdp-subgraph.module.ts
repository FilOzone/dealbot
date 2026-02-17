import { Module } from "@nestjs/common";
import { PDPSubgraphService } from "./pdp-subgraph.service.js";

@Module({
  providers: [PDPSubgraphService],
  exports: [PDPSubgraphService],
})
export class PdpSubgraphModule {}
