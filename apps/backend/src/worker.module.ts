import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ClickhouseModule } from "./clickhouse/clickhouse.module.js";
import { configValidationSchema, loadConfig } from "./config/app.config.js";
import { DatabaseModule } from "./database/database.module.js";
import { JobsModule } from "./jobs/jobs.module.js";
import { MetricsPrometheusModule } from "./metrics-prometheus/metrics-prometheus.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [loadConfig],
      validationSchema: configValidationSchema,
      isGlobal: true,
    }),
    DatabaseModule,
    MetricsPrometheusModule,
    ClickhouseModule,
    JobsModule,
  ],
})
export class WorkerModule {}
