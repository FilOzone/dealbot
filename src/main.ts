import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { VersionService } from "./common/version.service.js";

async function bootstrap() {
  const { AppModule } = await import("./app.module.js");
  const app = await NestFactory.create(AppModule, {
    logger: ["log", "fatal", "error", "warn"],
  });

  // Get version service and print version info
  const versionService = app.get(VersionService);
  versionService.printVersionInfo();
  const versionInfo = versionService.getVersionInfo();

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
  app.enableCors({
    origin: process.env.DEALBOT_ALLOWED_ORIGINS?.split(","),
  });

  const config = new DocumentBuilder()
    .setTitle("Dealbot")
    .setDescription("FWSS Dealbot API methods")
    .setVersion(versionInfo?.version || "unknown")
    .addTag("dealbot")
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api", app, document);

  await app.listen(process.env.DEALBOT_PORT || 3000, process.env.DEALBOT_HOST || "127.0.0.1");
}

bootstrap();
