import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
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
  // Configure CORS with support for wildcards and pattern matching
  // Uses express cors middleware native support for (string | RegExp)[]
  const allowedOriginsConfig = process.env.DEALBOT_ALLOWED_ORIGINS || "";
  const trimmedConfig = allowedOriginsConfig.trim();

  if (trimmedConfig === "*") {
    // Allow all origins (dev/testing only - NOT recommended for production)
    app.enableCors({
      origin: "*",
      credentials: false, // Cannot use credentials with wildcard
    });
  } else if (trimmedConfig === "") {
    // No origins configured - disable CORS (reject all cross-origin requests)
    app.enableCors({
      origin: false,
    });
  } else {
    // Parse origins and pre-compile regex patterns at startup
    // This avoids creating new RegExp objects on every request
    const corsOrigins: (string | RegExp)[] = trimmedConfig
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0)
      .map((origin) => {
        // Convert wildcard patterns (e.g., https://*.pages.dev) to pre-compiled RegExp
        if (origin.includes("*")) {
          const pattern = origin.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
          return new RegExp(`^${pattern}$`);
        }
        return origin;
      });

    app.enableCors({
      origin: corsOrigins,
      credentials: true, // Allow credentials with specific origins
    });
  }

  const config = new DocumentBuilder()
    .setTitle("Dealbot")
    .setDescription("FWSS Dealbot API methods")
    .setVersion("1.0")
    .addTag("dealbot")
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api", app, document);

  const port = process.env.DEALBOT_PORT || 3000;
  const host = process.env.DEALBOT_HOST || "127.0.0.1";
  await app.listen(port, host);
  logger.log(`Dealbot backend is running on ${host}:${port}`);
}

bootstrap();
