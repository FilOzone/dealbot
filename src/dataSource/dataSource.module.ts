import { ConfigModule } from "@nestjs/config";
import { Module } from "@nestjs/common";
import { DataSourceService } from "./dataSource.service";

@Module({
  imports: [ConfigModule],
  exports: [DataSourceService],
  providers: [DataSourceService],
})
export class DataSourceModule {}
