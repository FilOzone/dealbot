import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { AppController } from "./app.controller.js";
import { buildLoggerModuleParams } from "./common/pino.config.js";
import { validateConfig } from "./config/env.schema.js";
import { loadConfig } from "./config/loader.js";
import { DatabaseModule } from "./database/database.module.js";
import { DataSourceModule } from "./dataSource/dataSource.module.js";
import { DealModule } from "./deal/deal.module.js";
import { DevToolsModule } from "./dev-tools/dev-tools.module.js";
import { JobsModule } from "./jobs/jobs.module.js";
import { MetricsPrometheusModule } from "./metrics-prometheus/metrics-prometheus.module.js";
import { ProvidersModule } from "./providers/providers.module.js";
import { RetrievalModule } from "./retrieval/retrieval.module.js";

@Module({
  imports: [
    LoggerModule.forRoot(buildLoggerModuleParams()),
    ConfigModule.forRoot({
      load: [loadConfig],
      validate: validateConfig,
      isGlobal: true,
    }),
    DatabaseModule,
    MetricsPrometheusModule,
    JobsModule,
    DealModule,
    RetrievalModule,
    DataSourceModule,
    ProvidersModule,
    ...(process.env.ENABLE_DEV_MODE === "true" ? [DevToolsModule] : []),
  ],
  controllers: [AppController],
})
export class AppModule {}
