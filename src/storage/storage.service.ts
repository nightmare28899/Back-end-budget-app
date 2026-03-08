import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as Minio from "minio";
import { randomUUID } from "node:crypto";

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private minioClient: Minio.Client;
  private bucket: string;

  constructor(private readonly configService: ConfigService) {
    const isProduction =
      this.configService.get<string>("NODE_ENV") === "production";
    const accessKey = this.configService.get<string>(
      "MINIO_ACCESS_KEY",
      "minioadmin",
    );
    const secretKey = this.configService.get<string>(
      "MINIO_SECRET_KEY",
      "minioadmin",
    );

    if (
      isProduction &&
      (accessKey === "minioadmin" || secretKey === "minioadmin")
    ) {
      throw new Error(
        "MINIO_ACCESS_KEY and MINIO_SECRET_KEY must be configured with non-default values in production",
      );
    }

    this.bucket = this.configService.get<string>("MINIO_BUCKET", "receipts");
    this.minioClient = new Minio.Client({
      endPoint: this.configService.get<string>("MINIO_ENDPOINT", "localhost"),
      port: parseInt(this.configService.get<string>("MINIO_PORT", "9000"), 10),
      useSSL:
        this.configService.get<string>("MINIO_USE_SSL", "false") === "true",
      accessKey,
      secretKey,
    });
  }

  async onModuleInit() {
    try {
      const exists = await this.minioClient.bucketExists(this.bucket);
      if (!exists) {
        await this.minioClient.makeBucket(this.bucket);
        this.logger.log(`Bucket "${this.bucket}" created`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.logger.warn(
        `Could not connect to MinIO: ${message}. Image uploads will fail.`,
      );
    }
  }

  async uploadFile(
    file: Express.Multer.File,
    folder = "receipts",
  ): Promise<string> {
    const ext = file.originalname.split(".").pop();
    const objectName = `${folder}/${randomUUID()}.${ext}`;

    await this.minioClient.putObject(
      this.bucket,
      objectName,
      file.buffer,
      file.size,
      { "Content-Type": file.mimetype },
    );

    return objectName;
  }

  async getFileUrl(objectName: string): Promise<string> {
    return this.minioClient.presignedGetObject(this.bucket, objectName, 3600);
  }

  async deleteFile(objectName: string): Promise<void> {
    await this.minioClient.removeObject(this.bucket, objectName);
  }
}
