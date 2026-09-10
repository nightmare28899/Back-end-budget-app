import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { CardStatementsController } from "../src/card-statements/card-statements.controller";
import { CardStatementsService } from "../src/card-statements/card-statements.service";
import { JwtAuthGuard } from "../src/common/guards/jwt-auth.guard";

describe("Statement imports (e2e)", () => {
  let app: INestApplication<App>;

  const service = {
    createImport: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    updateRows: jest.fn(),
    confirm: jest.fn(),
    revert: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [CardStatementsController],
      providers: [{ provide: CardStatementsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => {
            getRequest: () => {
              headers: Record<string, string | undefined>;
              user?: object;
            };
          };
        }) => {
          const request = context.switchToHttp().getRequest();
          if (request.headers.authorization !== "Bearer test-token") {
            throw new UnauthorizedException();
          }
          request.user = {
            id: "user-1",
            email: "user@example.com",
            name: "User",
            role: "user",
            currency: "MXN",
          };
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("protects the statement import routes", async () => {
    await request(app.getHttpServer()).get("/statement-imports").expect(401);
  });

  it("accepts one PDF statement and scopes it to the current user", async () => {
    service.createImport.mockResolvedValue({
      id: "import-1",
      status: "UPLOADED",
      version: 1,
      duplicate: false,
    });

    await request(app.getHttpServer())
      .post("/statement-imports")
      .set("Authorization", "Bearer test-token")
      .attach("file", Buffer.from("%PDF-test"), {
        filename: "statement.pdf",
        contentType: "application/pdf",
      })
      .expect(201)
      .expect({
        id: "import-1",
        status: "UPLOADED",
        version: 1,
        duplicate: false,
      });

    expect(service.createImport).toHaveBeenCalledWith(
      "user-1",
      {},
      expect.objectContaining({ mimetype: "application/pdf" }),
    );
  });

  it("rejects non-PDF uploads before invoking the service", async () => {
    await request(app.getHttpServer())
      .post("/statement-imports")
      .set("Authorization", "Bearer test-token")
      .attach("file", Buffer.from("plain text"), {
        filename: "statement.txt",
        contentType: "text/plain",
      })
      .expect(400);

    expect(service.createImport).not.toHaveBeenCalled();
  });
});
