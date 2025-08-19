import { ConfigModule } from "@nestjs/config";
import { Module } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module";

@Module({
  imports: [ConfigModule, DatabaseModule],
  exports: [DatabaseModule],
})
export class InfrastructureModule {}
