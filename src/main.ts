import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";

async function bootstrap() {
  // Load and display version information
  let versionInfo: {
    version: string;
    commit: string;
    commitShort: string;
    branch: string;
    buildTime: string;
  };

  try {
    const versionPath = join(process.cwd(), "dist", "version.json");
    const versionData = readFileSync(versionPath, "utf-8");
    versionInfo = JSON.parse(versionData);

    console.log("=".repeat(60));
    console.log("Dealbot Starting...");
    console.log(`Version: ${versionInfo.version}`);
    console.log(`Commit: ${versionInfo.commit} (${versionInfo.commitShort})`);
    console.log(`Branch: ${versionInfo.branch}`);
    console.log(`Build Time: ${versionInfo.buildTime}`);
    console.log("=".repeat(60));
  } catch (error) {
    console.warn("Warning: Could not load version info:", error);
    versionInfo = {
      version: "unknown",
      commit: "unknown",
      commitShort: "unknown",
      branch: "unknown",
      buildTime: new Date().toISOString(),
    };
  }

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

  await app.listen(process.env.DEALBOT_PORT || 3000, process.env.DEALBOT_HOST || "127.0.0.1");
}

bootstrap();
