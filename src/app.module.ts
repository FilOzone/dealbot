import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ServeStaticModule } from "@nestjs/serve-static";
import { join } from "path";
import { AppController } from "./app.controller.js";
import { VersionService } from "./common/version.service.js";
import { configValidationSchema, loadConfig } from "./config/app.config.js";
import { DatabaseModule } from "./database/database.module.js";
import { DataSourceModule } from "./dataSource/dataSource.module.js";
import { DealModule } from "./deal/deal.module.js";
import { MetricsModule } from "./metrics/metrics.module.js";
import { RetrievalModule } from "./retrieval/retrieval.module.js";
import { SchedulerModule } from "./scheduler/scheduler.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [loadConfig],
      validationSchema: configValidationSchema,
      isGlobal: true,
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), "web", "dist"),
      exclude: ["/api/{*test}"],
    }),
    DatabaseModule,
    SchedulerModule,
    DealModule,
    RetrievalModule,
    DataSourceModule,
    MetricsModule,
  ],
  controllers: [AppController],
  providers: [VersionService],
})
export class AppModule {}
