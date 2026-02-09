import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
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
    JobsModule,
  ],
})
export class WorkerModule {}
