import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateConfig } from "./config/env.schema.js";
import { loadConfig } from "./config/loader.js";
import { DatabaseModule } from "./database/database.module.js";
import { JobsModule } from "./jobs/jobs.module.js";
import { MetricsPrometheusModule } from "./metrics-prometheus/metrics-prometheus.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [loadConfig],
      validate: validateConfig,
      isGlobal: true,
    }),
    DatabaseModule,
    MetricsPrometheusModule,
    JobsModule,
  ],
})
export class WorkerModule {}
