import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { HttpClientModule } from "../http-client/http-client.module.js";
import { IpniModule } from "../ipni/ipni.module.js";
import { SubgraphModule } from "../subgraph/subgraph.module.js";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { PieceRetrievalService } from "./piece-retrieval.service.js";
import { PieceValidationService } from "./piece-validation.service.js";
import { SampledPieceSelectorService } from "./sampled-piece-selector.service.js";
import { SampledRetrievalService } from "./sampled-retrieval.service.js";

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([StorageProvider]),
    SubgraphModule,
    WalletSdkModule,
    HttpClientModule,
    IpniModule,
  ],
  providers: [SampledPieceSelectorService, PieceRetrievalService, PieceValidationService, SampledRetrievalService],
  exports: [SampledRetrievalService],
})
export class SampledRetrievalModule {}
