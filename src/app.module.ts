import { ConfigModule } from "@nestjs/config";
import { Module } from "@nestjs/common";
import { SchedulerModule } from "./scheduler/scheduler.module";
import { DealModule } from "./deal/deal.module";
import { RetrievalModule } from "./retrieval/retrieval.module";
import { DataSourceModule } from "./dataSource/dataSource.module";
import { InfrastructureModule } from "./infrastructure/infrastructure.module";
import { configValidationSchema, loadConfig } from "./config/app.config";

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [loadConfig],
      validationSchema: configValidationSchema,
      isGlobal: true,
    }),
    InfrastructureModule,
    SchedulerModule,
    DealModule,
    RetrievalModule,
    DataSourceModule,
  ],
})
export class AppModule {}
