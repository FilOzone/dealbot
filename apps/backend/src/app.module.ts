import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppController } from "./app.controller.js";
import { configValidationSchema, loadConfig } from "./config/app.config.js";
import { DatabaseModule } from "./database/database.module.js";
import { DataSourceModule } from "./dataSource/dataSource.module.js";
import { DealModule } from "./deal/deal.module.js";
import { MetricsModule } from "./metrics/metrics.module.js";
import { MetricsPrometheusModule } from "./metrics-prometheus/metrics-prometheus.module.js";
import { RetrievalModule } from "./retrieval/retrieval.module.js";
import { SchedulerModule } from "./scheduler/scheduler.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [loadConfig],
      validationSchema: configValidationSchema,
      isGlobal: true,
    }),
    DatabaseModule,
    MetricsPrometheusModule,
    SchedulerModule,
    DealModule,
    RetrievalModule,
    DataSourceModule,
    MetricsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
