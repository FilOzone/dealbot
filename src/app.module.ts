import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { loadConfig, configValidationSchema } from "./config/app.config";
import { InfrastructureModule } from "./infrastructure/infrastructure.module";
import { DealModule } from "./deal/deal.module";
import { RetrievalModule } from "./retrieval/retrieval.module";
import { SchedulerModule } from "./scheduler/scheduler.module";
import { MetricsModule } from "./metrics/metrics.module";
import { DataSourceModule } from "./dataSource/dataSource.module";
import { StatsModule } from "./stats/stats.module";
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
