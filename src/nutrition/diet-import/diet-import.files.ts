import { BadRequestException } from "@nestjs/common";
import { sniffFileMime } from "../nutrition-original";

export const MAX_IMPORT_FILES = 3;
export const MAX_IMPORT_IMAGE_SIZE = 5 * 1024 * 1024;
export const MAX_IMPORT_PDF_SIZE = 10 * 1024 * 1024;
/** Multer hard cap; per-type limits are enforced after magic-byte detection. */
export const MAX_IMPORT_UPLOAD_SIZE = MAX_IMPORT_PDF_SIZE;

export type ImportMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "application/pdf";

export interface ImportUpload {
  originalname: string;
  buffer: Buffer;
}
export interface ImportFile {
  name: string;
  mime: ImportMime;
  bytes: Buffer;
}

const INVALID_MESSAGE =
  "Upload 1 to 3 JPG, PNG or WebP photos, or a single PDF, with a matching extension.";

/**
 * Validates an import upload: either 1-3 images (<= 5 MiB each) or exactly one
 * PDF (<= 10 MiB), detected by magic bytes. Never trusts the declared mime.
 */
export function validateImportFiles(
  uploads: ImportUpload[] | undefined,
): ImportFile[] {
  if (!uploads?.length) {
    throw new BadRequestException("Attach at least one photo or a PDF.");
  }
  if (uploads.length > MAX_IMPORT_FILES) {
    throw new BadRequestException(`Attach at most ${MAX_IMPORT_FILES} files.`);
  }

  const files = uploads.map((upload): ImportFile => {
    const mime = upload.buffer.length
      ? sniffFileMime(upload.originalname, upload.buffer)
      : null;
    if (mime === null) throw new BadRequestException(INVALID_MESSAGE);
    const limit =
      mime === "application/pdf" ? MAX_IMPORT_PDF_SIZE : MAX_IMPORT_IMAGE_SIZE;
    if (upload.buffer.length > limit) {
      throw new BadRequestException(
        mime === "application/pdf"
          ? "The PDF must be up to 10 MiB."
          : "Each photo must be up to 5 MiB.",
      );
    }
    return { name: upload.originalname, mime, bytes: upload.buffer };
  });

  const pdfs = files.filter((file) => file.mime === "application/pdf").length;
  if (pdfs > 0 && files.length > 1) {
    throw new BadRequestException(
      "Send either up to 3 photos or exactly one PDF, not both.",
    );
  }
  return files;
}
