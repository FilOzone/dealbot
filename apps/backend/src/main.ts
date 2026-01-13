import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cors from "cors";
import helmet from "helmet";

const logger = new Logger("Main");

async function bootstrap() {
  const { AppModule } = await import("./app.module.js");
  const app = await NestFactory.create(AppModule, {
    logger: ["log", "fatal", "error", "warn"],
  });

  // Ensure Nest calls lifecycle shutdown hooks (OnApplicationShutdown / BeforeApplicationShutdown)
  // so resources (DB pools, schedulers, etc.) can be released on SIGINT/SIGTERM.
  app.enableShutdownHooks();

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: [`'self'`],
          styleSrc: [`'self'`, `'unsafe-inline'`],
          imgSrc: [`'self'`, "data:", "validator.swagger.io"],
          scriptSrc: [`'self'`, `https: 'unsafe-inline'`],
          connectSrc: [`'self'`, `https:`],
        },
      },
    }),
  );

  // Configure CORS using express cors middleware directly
  const allowedOrigins = (process.env.DEALBOT_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  app.use(
    cors({
      credentials: true,
      origin: allowedOrigins.length > 0 ? allowedOrigins : false, // Disable CORS if no origins configured
    }),
  );

  const config = new DocumentBuilder()
    .setTitle("Dealbot")
    .setDescription("FWSS Dealbot API methods")
    .setVersion("1.0")
    .addTag("dealbot")
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api", app, document);

  const port = Number.parseInt(process.env.DEALBOT_PORT ?? "3000", 10);
  if (Number.isNaN(port)) {
    throw new Error(`Invalid DEALBOT_PORT: ${process.env.DEALBOT_PORT}`);
  }
  const host = process.env.DEALBOT_HOST || "127.0.0.1";
  await app.listen(port, host);
  logger.log(`Dealbot backend is running on ${host}:${port}`);
}

bootstrap();
