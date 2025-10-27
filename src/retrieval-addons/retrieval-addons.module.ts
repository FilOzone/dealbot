import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HttpClientModule } from "../http-client/http-client.module.js";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { RetrievalAddonsService } from "./retrieval-addons.service.js";
import { CdnRetrievalStrategy } from "./strategies/cdn.strategy.js";
import { DirectRetrievalStrategy } from "./strategies/direct.strategy.js";
import { IpniRetrievalStrategy } from "./strategies/ipni.strategy.js";

@Module({
  imports: [ConfigModule, WalletSdkModule, HttpClientModule],
  providers: [RetrievalAddonsService, DirectRetrievalStrategy, CdnRetrievalStrategy, IpniRetrievalStrategy],
  exports: [RetrievalAddonsService],
})
export class RetrievalAddonsModule {}
