import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Res,
  StreamableFile,
} from "@nestjs/common";
import type { Response } from "express";
import { StorageService } from "./storage.service";

@Controller("storage")
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Get("avatars/:filename")
  async getAvatar(
    @Param("filename") filename: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const normalizedFilename = filename.trim();
    if (!normalizedFilename) {
      throw new BadRequestException("Invalid avatar filename");
    }

    const objectName = `avatars/${normalizedFilename}`;
    const file = await this.storageService.getFileStream(objectName);

    response.setHeader("Cache-Control", "private, max-age=300");
    if (file.contentType) {
      response.setHeader("Content-Type", file.contentType);
    }
    if (file.contentLength !== null) {
      response.setHeader("Content-Length", String(file.contentLength));
    }

    return new StreamableFile(file.stream);
  }
}
