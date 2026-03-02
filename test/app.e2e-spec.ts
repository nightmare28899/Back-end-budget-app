import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import request from "supertest";
import { App } from "supertest/types";
import { AppModule } from "./../src/app.module";
import { PrismaService } from "./../src/prisma/prisma.service";
import { StorageService } from "./../src/storage/storage.service";

describe("AppController (e2e)", () => {
  let app: INestApplication<App>;

  const prismaMock = {
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    category: { findMany: jest.fn(), findFirst: jest.fn() },
    expense: { findMany: jest.fn(), findFirst: jest.fn() },
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };

  const storageMock = {
    uploadFile: jest.fn(),
    getFileUrl: jest.fn(),
    deleteFile: jest.fn(),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(StorageService)
      .useValue(storageMock)
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

  it("/auth/login (POST) validates body", () => {
    return request(app.getHttpServer())
      .post("/auth/login")
      .send({})
      .expect(400);
  });
});
