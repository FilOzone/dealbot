import { Module } from "@nestjs/common";
import { DataSourceService } from "./dataSource.service.js";

@Module({
  exports: [DataSourceService],
  providers: [DataSourceService],
})
export class DataSourceModule {}
