import { Module } from "@nestjs/common";
import { HttpClientModule } from "../http-client/http-client.module.js";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { RetrievalAddonsService } from "./retrieval-addons.service.js";
import { DirectRetrievalStrategy } from "./strategies/direct.strategy.js";
import { IpniRetrievalStrategy } from "./strategies/ipni.strategy.js";

@Module({
  imports: [WalletSdkModule, HttpClientModule],
  providers: [RetrievalAddonsService, DirectRetrievalStrategy, IpniRetrievalStrategy],
  exports: [RetrievalAddonsService],
})
export class RetrievalAddonsModule {}
