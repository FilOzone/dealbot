import { type INestApplication, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

describe("AppController (e2e)", () => {
  let app: INestApplication;

  @Module({})
  class EmptyModule {}

  beforeAll(async () => {
    // env required by Joi schema BEFORE AppModule import
    process.env.NODE_ENV = "test";
    process.env.DATABASE_HOST = "127.0.0.1";
    process.env.DATABASE_PORT = "5432";
    process.env.DATABASE_USER = "x";
    process.env.DATABASE_PASSWORD = "x";
    process.env.DATABASE_NAME = "x";
    process.env.WALLET_ADDRESS = "0x0000000000000000000000000000000000000000";
    process.env.WALLET_PRIVATE_KEY = "x";
    process.env.NETWORK = "calibration";

    // dynamic import after env is set (ConfigModule validates on import)
    const { AppModule } = await import("../src/app.module.js");
    const { DatabaseModule } = await import("../src/database/database.module.js");
    const { DealModule } = await import("../src/deal/deal.module.js");
    const { RetrievalModule } = await import("../src/retrieval/retrieval.module.js");
    const { SchedulerModule } = await import("../src/scheduler/scheduler.module.js");
    const { MetricsModule } = await import("../src/metrics/metrics.module.js");
    const { DataSourceModule } = await import("../src/dataSource/dataSource.module.js");

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // Health-only e2e: replace heavyweight modules with no-ops
      .overrideModule(DatabaseModule)
      .useModule(EmptyModule)
      .overrideModule(DealModule)
      .useModule(EmptyModule)
      .overrideModule(RetrievalModule)
      .useModule(EmptyModule)
      .overrideModule(SchedulerModule)
      .useModule(EmptyModule)
      .overrideModule(MetricsModule)
      .useModule(EmptyModule)
      .overrideModule(DataSourceModule)
      .useModule(EmptyModule)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("/api/health (GET)", async () => {
    await request(app.getHttpServer()).get("/api/health").expect(200).expect({ status: "ok" });
  });
});
