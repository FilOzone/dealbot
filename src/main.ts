import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { loadVersionInfo } from "./version/index.js";

/**
 * Load and display version information before NestJS starts
 */
function loadAndPrintVersion() {
  const versionInfo = loadVersionInfo();

  console.log("=".repeat(60));
  console.log("Dealbot Starting...");
  console.log(`Version: ${versionInfo.version}`);
  console.log(`Commit: ${versionInfo.commit} (${versionInfo.commitShort})`);
  console.log(`Branch: ${versionInfo.branch}`);
  console.log(`Build Time: ${versionInfo.buildTime}`);
  console.log("=".repeat(60));

  return versionInfo;
}

async function bootstrap() {
  // Print version info before NestJS initialization
  const versionInfo = loadAndPrintVersion();

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
    .setVersion(versionInfo.version)
    .addTag("dealbot")
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api", app, document);

  const port = process.env.DEALBOT_PORT || 3130;
  const host = process.env.DEALBOT_HOST || "127.0.0.1";

  await app.listen(port, host);

  console.log("=".repeat(60));
  console.log(`🚀 Application is listening on: http://${host}:${port}`);
  console.log(`📚 Swagger API documentation: http://${host}:${port}/api`);
  console.log("=".repeat(60));
}

bootstrap();
