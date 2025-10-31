import { Module } from "@nestjs/common";
import { DealAddonsService } from "./deal-addons.service.js";
import { CdnAddonStrategy } from "./strategies/cdn.strategy.js";
import { DirectAddonStrategy } from "./strategies/direct.strategy.js";
import { IpniAddonStrategy } from "./strategies/ipni.strategy.js";

@Module({
  providers: [DealAddonsService, DirectAddonStrategy, CdnAddonStrategy, IpniAddonStrategy],
  exports: [DealAddonsService],
})
export class DealAddonsModule {}
