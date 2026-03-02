import { BadRequestException } from "@nestjs/common";
import { MulterOptions } from "@nestjs/platform-express/multer/interfaces/multer-options.interface";

const DEFAULT_MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024;

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

export function buildImageUploadOptions(
  maxFileSize = DEFAULT_MAX_IMAGE_FILE_SIZE,
): MulterOptions {
  return {
    limits: { fileSize: maxFileSize },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
        cb(new BadRequestException("Only image files are allowed"), false);
        return;
      }

      cb(null, true);
    },
  };
}
