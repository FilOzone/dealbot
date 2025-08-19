import { NestFactory } from "@nestjs/core";
import helmet from "helmet";

async function bootstrap() {
  const { AppModule } = await import("./app.module.js");
  const app = await NestFactory.create(AppModule, {
    logger: ["log", "fatal", "error", "warn"],
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: [`'self'`],
          styleSrc: [`'self'`, `'unsafe-inline'`],
          imgSrc: [`'self'`, "data:", "validator.swagger.io"],
          scriptSrc: [`'self'`, `https: 'unsafe-inline'`],
        },
      },
    }),
  );
  app.enableCors({
    origin: process.env.DEALBOT_ALLOWED_ORIGINS?.split(","),
  });

  await app.listen(process.env.DEALBOT_PORT || 3000, process.env.DEALBOT_HOST || "127.0.0.1");
}

bootstrap();
