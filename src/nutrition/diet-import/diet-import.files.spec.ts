import { BadRequestException } from "@nestjs/common";
import {
  MAX_IMPORT_IMAGE_SIZE,
  MAX_IMPORT_PDF_SIZE,
  validateImportFiles,
} from "./diet-import.files";

const jpeg = (extra = 0) =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0]),
    Buffer.alloc(extra),
    Buffer.from([0xff, 0xd9]),
  ]);
const webp = () =>
  Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.from([8, 0, 0, 0]),
    Buffer.from("WEBPVP8 "),
  ]);
const pdf = (extra = 0) =>
  Buffer.concat([
    Buffer.from("%PDF-1.7\n"),
    Buffer.alloc(extra),
    Buffer.from("\n%%EOF\n"),
  ]);
const file = (originalname: string, buffer: Buffer) => ({
  originalname,
  buffer,
});

describe("validateImportFiles", () => {
  it("accepts one to three images and returns verified mimes", () => {
    const result = validateImportFiles([
      file("a.jpg", jpeg()),
      file("b.webp", webp()),
    ]);
    expect(result.map((entry) => entry.mime)).toEqual([
      "image/jpeg",
      "image/webp",
    ]);
  });

  it("accepts exactly one pdf up to 10 MiB", () => {
    const result = validateImportFiles([
      file("plan.pdf", pdf(6 * 1024 * 1024)),
    ]);
    expect(result[0].mime).toBe("application/pdf");
  });

  it.each([[undefined], [[]]])("rejects no files (%p)", (input) => {
    expect(() => validateImportFiles(input)).toThrow(BadRequestException);
  });

  it("rejects more than three files", () => {
    const four = Array.from({ length: 4 }, (_, i) => file(`${i}.jpg`, jpeg()));
    expect(() => validateImportFiles(four)).toThrow(BadRequestException);
  });

  it("rejects mixing a pdf with images and multiple pdfs", () => {
    expect(() =>
      validateImportFiles([file("a.jpg", jpeg()), file("b.pdf", pdf())]),
    ).toThrow(BadRequestException);
    expect(() =>
      validateImportFiles([file("a.pdf", pdf()), file("b.pdf", pdf())]),
    ).toThrow(BadRequestException);
  });

  it("rejects wrong magic bytes or extension", () => {
    expect(() =>
      validateImportFiles([file("a.jpg", Buffer.from("not an image data"))]),
    ).toThrow(BadRequestException);
    expect(() => validateImportFiles([file("a.png", jpeg())])).toThrow(
      BadRequestException,
    );
  });

  it("enforces 5 MiB per image and 10 MiB per pdf", () => {
    expect(() =>
      validateImportFiles([file("a.jpg", jpeg(MAX_IMPORT_IMAGE_SIZE))]),
    ).toThrow(BadRequestException);
    expect(() =>
      validateImportFiles([file("a.pdf", pdf(MAX_IMPORT_PDF_SIZE))]),
    ).toThrow(BadRequestException);
  });
});
