import { Module } from "@nestjs/common";
import { RetrievalService } from "./retrieval.service.js";
import { InfrastructureModule } from "../infrastructure/infrastructure.module.js";
import { MetricsModule } from "../metrics/metrics.module.js";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { HttpClientModule } from "../http-client/http-client.module.js";

@Module({
  imports: [InfrastructureModule, HttpClientModule, MetricsModule, WalletSdkModule],
  providers: [RetrievalService],
  exports: [RetrievalService],
})
export class RetrievalModule {}
