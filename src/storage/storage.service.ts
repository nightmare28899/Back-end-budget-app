import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as Minio from "minio";
import { randomUUID } from "node:crypto";

const DEFAULT_MINIO_OPERATION_TIMEOUT_MS = 5000;

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private minioClient: Minio.Client;
  private bucket: string;
  private readonly minioOperationTimeoutMs: number;
  private readonly minioConfig: {
    endPoint: string;
    port: number;
    useSSL: boolean;
    region?: string;
  };

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

    const endPoint = this.configService.get<string>(
      "MINIO_ENDPOINT",
      "localhost",
    );
    const portRaw = this.configService.get<string>("MINIO_PORT", "9000");
    const port = Number.parseInt(portRaw, 10);
    const useSSL =
      this.configService.get<string>("MINIO_USE_SSL", "false") === "true";
    const region = this.configService.get<string>("MINIO_REGION");
    const timeoutRaw = this.configService.get<string>(
      "MINIO_OPERATION_TIMEOUT_MS",
      `${DEFAULT_MINIO_OPERATION_TIMEOUT_MS}`,
    );
    const timeout = Number.parseInt(timeoutRaw, 10);

    if (Number.isNaN(port)) {
      throw new Error("MINIO_PORT must be a valid number");
    }
    if (Number.isNaN(timeout) || timeout <= 0) {
      throw new Error(
        "MINIO_OPERATION_TIMEOUT_MS must be a valid positive number",
      );
    }

    this.minioConfig = {
      endPoint,
      port,
      useSSL,
      region,
    };
    this.minioOperationTimeoutMs = timeout;
    this.bucket = this.configService.get<string>("MINIO_BUCKET", "receipts");
    this.minioClient = new Minio.Client({
      endPoint: this.minioConfig.endPoint,
      port: this.minioConfig.port,
      useSSL: this.minioConfig.useSSL,
      accessKey,
      secretKey,
      region: this.minioConfig.region,
    });
  }

  async onModuleInit() {
    this.logger.log(
      `MinIO target configured: ${this.describeMinioTarget()} (timeout=${this.minioOperationTimeoutMs}ms)`,
    );

    try {
      const exists = await this.withTimeout("bucketExists", () =>
        this.minioClient.bucketExists(this.bucket),
      );
      if (!exists) {
        await this.withTimeout("makeBucket", () =>
          this.minioClient.makeBucket(this.bucket),
        );
        this.logger.log(`Bucket "${this.bucket}" created`);
      }
    } catch (error) {
      this.logger.error(
        `Could not connect to MinIO (${this.describeMinioTarget()}): ${this.formatStorageError(
          error,
        )}. Image uploads will fail.`,
      );
    }
  }

  async uploadFile(
    file: Express.Multer.File,
    folder = "receipts",
  ): Promise<string> {
    const ext = file.originalname.split(".").pop();
    const objectName = `${folder}/${randomUUID()}.${ext}`;

    try {
      await this.withTimeout("putObject", () =>
        this.minioClient.putObject(
          this.bucket,
          objectName,
          file.buffer,
          file.size,
          { "Content-Type": file.mimetype },
        ),
      );
    } catch (error) {
      this.logger.error(
        `MinIO upload failed (${this.describeMinioTarget()}, object="${objectName}"): ${this.formatStorageError(
          error,
        )}`,
      );
      throw new ServiceUnavailableException(
        "File storage service is unavailable. Please try again later.",
      );
    }

    return objectName;
  }

  async getFileUrl(objectName: string): Promise<string> {
    try {
      return await this.withTimeout("presignedGetObject", () =>
        this.minioClient.presignedGetObject(this.bucket, objectName, 3600),
      );
    } catch (error) {
      this.logger.error(
        `MinIO presigned URL generation failed (${this.describeMinioTarget()}, object="${objectName}"): ${this.formatStorageError(
          error,
        )}`,
      );
      throw new ServiceUnavailableException(
        "File storage service is unavailable. Please try again later.",
      );
    }
  }

  async deleteFile(objectName: string): Promise<void> {
    try {
      await this.withTimeout("removeObject", () =>
        this.minioClient.removeObject(this.bucket, objectName),
      );
    } catch (error) {
      this.logger.error(
        `MinIO delete failed (${this.describeMinioTarget()}, object="${objectName}"): ${this.formatStorageError(
          error,
        )}`,
      );
      throw new ServiceUnavailableException(
        "File storage service is unavailable. Please try again later.",
      );
    }
  }

  private describeMinioTarget(): string {
    const protocol = this.minioConfig.useSSL ? "https" : "http";
    const region = this.minioConfig.region
      ? `, region=${this.minioConfig.region}`
      : "";
    return `${protocol}://${this.minioConfig.endPoint}:${this.minioConfig.port} (bucket=${this.bucket}${region})`;
  }

  private formatStorageError(error: unknown): string {
    if (!(error instanceof Error)) {
      return "Unknown error";
    }

    const minioError = error as Error & {
      code?: string;
      statusCode?: number;
      amzRequestid?: string;
      amzId2?: string;
      amzBucketRegion?: string;
    };

    const metadata = [
      minioError.code ? `code=${minioError.code}` : null,
      minioError.statusCode ? `status=${minioError.statusCode}` : null,
      minioError.amzRequestid
        ? `amzRequestId=${minioError.amzRequestid}`
        : null,
      minioError.amzId2 ? `amzId2=${minioError.amzId2}` : null,
      minioError.amzBucketRegion
        ? `amzBucketRegion=${minioError.amzBucketRegion}`
        : null,
    ]
      .filter((value): value is string => Boolean(value))
      .join(", ");

    if (metadata) {
      return `${minioError.name}: ${minioError.message} [${metadata}]`;
    }

    return `${minioError.name}: ${minioError.message}`;
  }

  private async withTimeout<T>(
    operationName: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const timeoutError = Object.assign(
      new Error(
        `MinIO operation "${operationName}" timed out after ${this.minioOperationTimeoutMs}ms`,
      ),
      {
        name: "MinioOperationTimeoutError",
        code: "ETIMEDOUT",
      },
    );

    let timeout: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(timeoutError);
      }, this.minioOperationTimeoutMs);
    });

    try {
      return await Promise.race([operation(), timeoutPromise]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}
