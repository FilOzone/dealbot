import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { loadConfig, configValidationSchema } from "./config/app.config.js";
import { InfrastructureModule } from "./infrastructure/infrastructure.module.js";
import { DealModule } from "./deal/deal.module.js";
import { RetrievalModule } from "./retrieval/retrieval.module.js";
import { SchedulerModule } from "./scheduler/scheduler.module.js";
import { MetricsModule } from "./metrics/metrics.module.js";
import { DataSourceModule } from "./dataSource/dataSource.module.js";
import { StatsModule } from "./stats/stats.module.js";
import { ServeStaticModule } from "@nestjs/serve-static";
import { join } from "path";

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [loadConfig],
      validationSchema: configValidationSchema,
      isGlobal: true,
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), "web", "dist"),
      exclude: ["/api*"],
    }),
    InfrastructureModule,
    SchedulerModule,
    DealModule,
    RetrievalModule,
    DataSourceModule,
    MetricsModule,
    StatsModule,
  ],
})
export class AppModule {}
