import { BadRequestException } from "@nestjs/common";
import {
  MAX_ORIGINAL_SIZE,
  buildOriginalUploadOptions,
  encodeContentDispositionFilename,
  validateOriginal,
} from "./nutrition-original";

const jpeg = () =>
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9]);
const png = () =>
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.from([0, 0, 0, 13]),
    Buffer.from("IHDR"),
    Buffer.alloc(21),
    Buffer.from("IEND"),
    Buffer.alloc(4),
  ]);
const pdf = () => Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");

describe("validateOriginal", () => {
  it("accepts a valid JPEG, PNG and PDF with matching extension", () => {
    expect(validateOriginal("a.JPG", jpeg())).toBe("image/jpeg");
    expect(validateOriginal("a.jpeg", jpeg())).toBe("image/jpeg");
    expect(validateOriginal("a.png", png())).toBe("image/png");
    expect(validateOriginal("a.pdf", pdf())).toBe("application/pdf");
  });

  it("rejects mismatched extension and content", () => {
    expect(() => validateOriginal("a.png", jpeg())).toThrow(
      BadRequestException,
    );
    expect(() => validateOriginal("a.pdf", png())).toThrow(BadRequestException);
    expect(() => validateOriginal("a.exe", pdf())).toThrow(BadRequestException);
  });

  it("rejects empty and oversized files", () => {
    expect(() => validateOriginal("a.pdf", Buffer.alloc(0))).toThrow(
      BadRequestException,
    );
    expect(() =>
      validateOriginal("a.pdf", Buffer.alloc(MAX_ORIGINAL_SIZE + 1)),
    ).toThrow(BadRequestException);
  });

  it("rejects truncated files", () => {
    expect(() => validateOriginal("a.pdf", Buffer.from("%PDF-1.7\n"))).toThrow(
      BadRequestException,
    );
  });
});

describe("buildOriginalUploadOptions", () => {
  it("limits uploads to one file of at most 5 MiB", () => {
    const options = buildOriginalUploadOptions();
    expect(options.limits).toEqual({ fileSize: MAX_ORIGINAL_SIZE, files: 1 });
  });
});

describe("encodeContentDispositionFilename", () => {
  it("percent-encodes RFC 5987 reserved characters", () => {
    expect(encodeContentDispositionFilename("diet (1)*'é.pdf")).toBe(
      "diet%20%281%29%2A%27%C3%A9.pdf",
    );
  });
});
