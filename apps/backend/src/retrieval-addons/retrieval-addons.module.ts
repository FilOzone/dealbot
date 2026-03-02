import { Module } from "@nestjs/common";
import { HttpClientModule } from "../http-client/http-client.module.js";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { RetrievalAddonsService } from "./retrieval-addons.service.js";
import { IpfsBlockRetrievalStrategy } from "./strategies/ipfs-block.strategy.js";

@Module({
  imports: [WalletSdkModule, HttpClientModule],
  providers: [RetrievalAddonsService, IpfsBlockRetrievalStrategy],
  exports: [RetrievalAddonsService],
})
export class RetrievalAddonsModule {}
