import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { mapNutritionDatabaseError } from "./nutrition-db-errors";
import {
  MAX_ORIGINAL_NAME_LENGTH,
  validateOriginal,
} from "./nutrition-original";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface NutritionOriginalDownload {
  stream: Readable;
  mime: string;
  name: string;
  contentLength: number | null;
}

@Injectable()
export class NutritionService {
  private readonly logger = new Logger(NutritionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Whole workspace state for the user. The SQL function creates the nutrition
   * profile on first access (named after the backend user).
   */
  async getState(userId: string): Promise<unknown> {
    const rows = await this.prisma.$queryRaw<Array<{ state: unknown }>>`
      SELECT public.nutrition_state(${userId}::text) AS state`;
    return rows[0]?.state ?? null;
  }

  async runCommand(
    userId: string,
    command: string,
    payload: Record<string, unknown>,
  ): Promise<{ ok: true }> {
    await this.execute(userId, command, payload);
    return { ok: true };
  }

  async storeOriginal(
    userId: string,
    dietId: string,
    file?: Express.Multer.File,
  ): Promise<{ ok: true; id: string }> {
    if (!file?.buffer) {
      throw new BadRequestException("Choose an original file.");
    }

    // multer decodes multipart file names as latin1; restore UTF-8.
    const name =
      Buffer.from(file.originalname, "latin1").toString("utf8").trim() ||
      file.originalname;
    const mime = validateOriginal(name, file.buffer);

    const diet = await this.prisma.nutritionDiet.findFirst({
      where: { id: dietId, ownerId: userId },
      select: { id: true },
    });
    if (!diet) {
      throw new NotFoundException("Diet unavailable.");
    }

    const path = await this.storage.uploadBuffer(file.buffer, {
      folder: `nutrition/${userId}`,
      mimeType: mime,
      extension: null,
      size: file.buffer.length,
    });
    const id = path.split("/").pop() ?? "";
    if (!UUID.test(id)) {
      await this.discardObject(path);
      throw new BadRequestException("Invalid original ownership.");
    }

    try {
      await this.execute(userId, "original_file", {
        id,
        dietId,
        path,
        name: name.slice(0, MAX_ORIGINAL_NAME_LENGTH),
        mime,
        size: file.buffer.length,
        hash: createHash("sha256").update(file.buffer).digest("hex"),
      });
    } catch (error) {
      await this.discardObject(path);
      throw error;
    }

    return { ok: true, id };
  }

  async getOriginal(
    userId: string,
    fileId: string,
  ): Promise<NutritionOriginalDownload> {
    const record = await this.prisma.nutritionDietOriginalFile.findFirst({
      where: { id: fileId, ownerId: userId },
      select: { path: true, mime: true, name: true },
    });
    if (!record) {
      throw new NotFoundException("File not found");
    }

    const object = await this.storage.getFileStream(record.path);
    return {
      stream: object.stream,
      mime: record.mime,
      name: record.name,
      contentLength: object.contentLength,
    };
  }

  private async execute(
    userId: string,
    command: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.$queryRaw`
        SELECT public.nutrition_command(
          ${userId}::text,
          ${command}::text,
          ${JSON.stringify(payload)}::jsonb
        ) AS result`;
    } catch (error) {
      mapNutritionDatabaseError(error);
    }
  }

  private async discardObject(path: string): Promise<void> {
    try {
      await this.storage.deleteFile(path);
    } catch {
      this.logger.warn(`Orphaned nutrition original needs cleanup: ${path}`);
    }
  }
}
