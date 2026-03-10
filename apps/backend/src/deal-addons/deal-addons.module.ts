import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Deal } from "../database/entities/deal.entity.js";
import { HttpClientModule } from "../http-client/http-client.module.js";
import { IpniModule } from "../ipni/ipni.module.js";
import { DealAddonsService } from "./deal-addons.service.js";
import { DirectAddonStrategy } from "./strategies/direct.strategy.js";
import { IpniAddonStrategy } from "./strategies/ipni.strategy.js";

@Module({
  imports: [TypeOrmModule.forFeature([Deal]), HttpClientModule, IpniModule],
  providers: [DealAddonsService, DirectAddonStrategy, IpniAddonStrategy],
  exports: [DealAddonsService],
})
export class DealAddonsModule {}
