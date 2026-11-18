import { BadRequestException } from "@nestjs/common";
import type { MulterOptions } from "@nestjs/platform-express/multer/interfaces/multer-options.interface";

export const MAX_ORIGINAL_SIZE = 5 * 1024 * 1024;
export const MAX_ORIGINAL_NAME_LENGTH = 200;

export type OriginalMime = "image/jpeg" | "image/png" | "application/pdf";

const INVALID_ORIGINAL_MESSAGE =
  "The original must be a valid JPG, PNG or PDF with a matching extension.";

/** Multer options: one in-memory file, hard-capped at 5 MiB. */
export function buildOriginalUploadOptions(): MulterOptions {
  return { limits: { fileSize: MAX_ORIGINAL_SIZE, files: 1 } };
}

/**
 * Checks size, extension and magic bytes of an uploaded original and returns
 * the verified mime type. The client-declared mime type is never trusted.
 */
export function validateOriginal(name: string, bytes: Buffer): OriginalMime {
  if (!bytes.length || bytes.length > MAX_ORIGINAL_SIZE) {
    throw new BadRequestException("Choose a file up to 5 MiB.");
  }

  const mime = sniffFileMime(name, bytes);
  if (mime === null || mime === "image/webp") {
    throw new BadRequestException(INVALID_ORIGINAL_MESSAGE);
  }
  return mime;
}

/**
 * Detects the mime type from extension + magic bytes, or null when they do
 * not agree. Size limits are the caller's responsibility.
 */
export function sniffFileMime(
  name: string,
  bytes: Buffer,
): OriginalMime | "image/webp" | null {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const starts = (values: number[]) =>
    values.every((value, index) => bytes[index] === value);

  if (
    ["jpg", "jpeg"].includes(extension) &&
    bytes.length >= 12 &&
    starts([255, 216, 255]) &&
    bytes[bytes.length - 2] === 255 &&
    bytes[bytes.length - 1] === 217
  ) {
    return "image/jpeg";
  }

  if (
    extension === "png" &&
    bytes.length >= 45 &&
    starts([137, 80, 78, 71, 13, 10, 26, 10]) &&
    bytes.subarray(12, 16).toString("latin1") === "IHDR" &&
    bytes.subarray(-8, -4).toString("latin1") === "IEND"
  ) {
    return "image/png";
  }

  if (
    extension === "webp" &&
    bytes.length >= 16 &&
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }

  if (
    extension === "pdf" &&
    /^%PDF-[12]\.[0-9]/.test(bytes.subarray(0, 8).toString("latin1")) &&
    bytes.subarray(-1024).toString("latin1").includes("%%EOF")
  ) {
    return "application/pdf";
  }

  return null;
}

/** RFC 5987 value for `filename*=UTF-8''...` in Content-Disposition. */
export function encodeContentDispositionFilename(name: string): string {
  return encodeURIComponent(name).replace(
    /[!'()*]/g,
    (value) => `%${value.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
