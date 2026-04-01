import { NestFactory } from "@nestjs/core";
import { Logger, ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { json, urlencoded } from "express";
import helmet from "helmet";
import basicAuth from "express-basic-auth";
import { randomBytes } from "node:crypto";
import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter";

const WEAK_SECRET_VALUES = new Set([
  "changeme",
  "change-me",
  "secret",
  "password",
  "default",
  "123456",
]);

function assertStrongProductionSecrets(): void {
  const isProduction = process.env.NODE_ENV === "production";
  if (!isProduction) {
    return;
  }

  const requiredSecrets: Array<[string, string | undefined]> = [
    ["JWT_SECRET", process.env.JWT_SECRET],
    ["JWT_REFRESH_SECRET", process.env.JWT_REFRESH_SECRET],
  ];

  for (const [name, rawValue] of requiredSecrets) {
    const value = rawValue?.trim();
    if (!value) {
      throw new Error(`${name} must be set in production`);
    }

    if (WEAK_SECRET_VALUES.has(value.toLowerCase())) {
      throw new Error(`${name} cannot use a weak/default value in production`);
    }
  }
}

async function bootstrap() {
  assertStrongProductionSecrets();

  const app = await NestFactory.create(AppModule);
  const logger = new Logger("Bootstrap");
  const globalPrefix = "api";
  const isProduction = process.env.NODE_ENV === "production";
  app.setGlobalPrefix(globalPrefix);
  const httpApp = app.getHttpAdapter().getInstance() as {
    disable?: (setting: string) => void;
  };
  httpApp.disable?.("x-powered-by");

  const bodyLimit = process.env.API_BODY_LIMIT || "1mb";
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());

  const corsOrigin = process.env.CORS_ORIGIN;
  const allowedOrigins = corsOrigin
    ? corsOrigin
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0)
    : [];

  if (isProduction && allowedOrigins.length === 0) {
    throw new Error(
      "CORS_ORIGIN must be configured in production to prevent accidental open CORS.",
    );
  }

  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : !isProduction,
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    credentials: true,
  });

  const swaggerUsername = process.env.SWAGGER_USERNAME?.trim();
  const swaggerPassword = process.env.SWAGGER_PASSWORD?.trim();
  const enableSwagger =
    !isProduction || Boolean(swaggerUsername && swaggerPassword);

  if (enableSwagger) {
    const resolvedSwaggerUsername = swaggerUsername || "dev";
    const resolvedSwaggerPassword =
      swaggerPassword || randomBytes(12).toString("hex");

    if (!swaggerUsername || !swaggerPassword) {
      logger.warn(
        `Swagger docs are enabled with generated non-production credentials: ${resolvedSwaggerUsername} / ${resolvedSwaggerPassword}`,
      );
    }

    const basicAuthMiddleware = basicAuth({
      challenge: true,
      users: {
        [resolvedSwaggerUsername]: resolvedSwaggerPassword,
      },
    });
    app.use("/api/docs", basicAuthMiddleware);
    app.use("/api/docs-json", basicAuthMiddleware);

    const config = new DocumentBuilder()
      .setTitle("BudgetApp API")
      .setDescription("Personal finance and expense tracking API")
      .setVersion("1.0")
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("docs", app, document, { useGlobalPrefix: true });
  } else {
    logger.warn(
      "Swagger docs are disabled in production because SWAGGER_USERNAME and SWAGGER_PASSWORD are not set.",
    );
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
}

void bootstrap();
