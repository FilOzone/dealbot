import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { ClickhouseModule } from "./clickhouse/clickhouse.module.js";
import { buildLoggerModuleParams } from "./common/pino.config.js";
import { loadConfig, validateConfig } from "./config/index.js";
import { DatabaseModule } from "./database/database.module.js";
import { JobsModule } from "./jobs/jobs.module.js";
import { MetricsPrometheusModule } from "./metrics-prometheus/metrics-prometheus.module.js";
import { PullCheckModule } from "./pull-check/pull-check.module.js";

@Module({
  imports: [
    LoggerModule.forRoot(buildLoggerModuleParams()),
    ConfigModule.forRoot({
      isGlobal: true,
      load: [loadConfig],
      validate: validateConfig,
    }),
    DatabaseModule,
    MetricsPrometheusModule,
    ClickhouseModule,
    JobsModule,
    PullCheckModule,
  ],
})
export class WorkerModule {}
