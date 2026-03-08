import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { timingSafeEqual } from "crypto";
import {
  json,
  urlencoded,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import { AppModule } from "./app.module";

const WEAK_SECRET_VALUES = new Set([
  "dev_jwt_secret",
  "dev_refresh_secret",
  "changeme",
  "change-me",
  "secret",
  "password",
  "default",
  "123456",
]);

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

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

function requestSwaggerAuth(res: Response): void {
  res.setHeader("WWW-Authenticate", 'Basic realm="Swagger Docs"');
  res.status(401).send("Authentication required");
}

function createSwaggerAuthMiddleware(
  expectedUsername: string,
  expectedPassword: string,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Basic ")) {
      requestSwaggerAuth(res);
      return;
    }

    let decodedCredentials = "";
    try {
      const base64Credentials = authHeader.slice("Basic ".length).trim();
      decodedCredentials = Buffer.from(base64Credentials, "base64").toString(
        "utf8",
      );
    } catch {
      requestSwaggerAuth(res);
      return;
    }

    const separatorIndex = decodedCredentials.indexOf(":");
    if (separatorIndex < 0) {
      requestSwaggerAuth(res);
      return;
    }

    const providedUsername = decodedCredentials.slice(0, separatorIndex);
    const providedPassword = decodedCredentials.slice(separatorIndex + 1);
    const isValidUser = safeEqual(providedUsername, expectedUsername);
    const isValidPassword = safeEqual(providedPassword, expectedPassword);

    if (!isValidUser || !isValidPassword) {
      requestSwaggerAuth(res);
      return;
    }

    next();
  };
}

async function bootstrap() {
  assertStrongProductionSecrets();

  const app = await NestFactory.create(AppModule);
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

  const corsOrigin = process.env.CORS_ORIGIN;
  const allowedOrigins = corsOrigin
    ? corsOrigin
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0)
    : [];

  if (isProduction && allowedOrigins.length === 0) {
    console.warn(
      "CORS is disabled in production because CORS_ORIGIN is not configured.",
    );
  }

  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : !isProduction,
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    credentials: true,
  });

  const config = new DocumentBuilder()
    .setTitle("BudgetApp API")
    .setDescription("Personal finance and expense tracking API")
    .setVersion("1.0")
    .addBearerAuth()
    .build();

  const swaggerUsername = process.env.SWAGGER_USERNAME;
  const swaggerPassword = process.env.SWAGGER_PASSWORD;

  if (swaggerUsername && swaggerPassword) {
    const swaggerAuthMiddleware = createSwaggerAuthMiddleware(
      swaggerUsername,
      swaggerPassword,
    );
    app.use(
      [`/${globalPrefix}/docs`, `/${globalPrefix}/docs-json`],
      swaggerAuthMiddleware,
    );
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("docs", app, document, { useGlobalPrefix: true });
    console.log("Swagger docs are protected with HTTP Basic Auth");
  } else if (!isProduction) {
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("docs", app, document, { useGlobalPrefix: true });
    console.log(
      "Swagger docs are public. Set SWAGGER_USERNAME and SWAGGER_PASSWORD to protect them.",
    );
  } else {
    console.warn(
      "Swagger docs are disabled in production because SWAGGER_USERNAME/SWAGGER_PASSWORD are not set.",
    );
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`BudgetApp API running on http://localhost:${port}`);
  console.log(`Swagger docs at http://localhost:${port}/${globalPrefix}/docs`);
}

void bootstrap();
