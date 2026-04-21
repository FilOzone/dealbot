import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Retrieval } from "../database/entities/retrieval.entity.js";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { HttpClientModule } from "../http-client/http-client.module.js";
import { IpniModule } from "../ipni/ipni.module.js";
import { PdpSubgraphModule } from "../pdp-subgraph/pdp-subgraph.module.js";
import { WalletSdkModule } from "../wallet-sdk/wallet-sdk.module.js";
import { AnonPieceSelectorService } from "./anon-piece-selector.service.js";
import { AnonRetrievalService } from "./anon-retrieval.service.js";
import { CarValidationService } from "./car-validation.service.js";
import { PieceRetrievalService } from "./piece-retrieval.service.js";

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Retrieval, StorageProvider]),
    PdpSubgraphModule,
    WalletSdkModule,
    HttpClientModule,
    IpniModule,
  ],
  providers: [AnonPieceSelectorService, PieceRetrievalService, CarValidationService, AnonRetrievalService],
  exports: [AnonRetrievalService],
})
export class RetrievalAnonModule {}
