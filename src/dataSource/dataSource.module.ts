import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DataSourceService } from "./dataSource.service.js";

@Module({
  imports: [ConfigModule],
  exports: [DataSourceService],
  providers: [DataSourceService],
})
export class DataSourceModule {}
