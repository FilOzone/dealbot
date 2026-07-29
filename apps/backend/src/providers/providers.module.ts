import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { StorageProvider } from "../database/entities/storage-provider.entity.js";
import { ProvidersController } from "./providers.controller.js";
import { ProvidersService } from "./providers.service.js";
import { StorageProviderRepository } from "./repositories/storage-provider.repository.js";

@Module({
  imports: [TypeOrmModule.forFeature([StorageProvider])],
  controllers: [ProvidersController],
  providers: [ProvidersService, StorageProviderRepository],
  exports: [ProvidersService, StorageProviderRepository],
})
export class ProvidersModule {}
