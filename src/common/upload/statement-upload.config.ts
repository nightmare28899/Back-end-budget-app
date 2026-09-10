import { BadRequestException } from "@nestjs/common";
import { MulterOptions } from "@nestjs/platform-express/multer/interfaces/multer-options.interface";

export const DEFAULT_MAX_STATEMENT_FILE_SIZE = 10 * 1024 * 1024;

export function buildStatementUploadOptions(
  maxFileSize = DEFAULT_MAX_STATEMENT_FILE_SIZE,
): MulterOptions {
  return {
    limits: {
      fileSize: maxFileSize,
      files: 1,
    },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype !== "application/pdf") {
        cb(new BadRequestException("Only PDF statements are allowed"), false);
        return;
      }

      cb(null, true);
    },
  };
}
