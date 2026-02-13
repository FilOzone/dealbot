import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";

describe("AppController (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const { AppController } = await import("../src/app.controller.js");

    const moduleRef = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: ConfigService,
          useValue: {
            get: () => ({}),
          },
        },
      ],
    }).compile();

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
