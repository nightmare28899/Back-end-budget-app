import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { NutritionService } from "./nutrition.service";

const USER = "11111111-1111-4111-8111-111111111111";
const DIET = "22222222-2222-4222-8222-222222222222";
const FILE_ID = "33333333-3333-4333-8333-333333333333";
const pdfBytes = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");

function pgError(code: string) {
  return Object.assign(new Error(`db failure ${code}`), {
    code: "P2010",
    meta: { code },
  });
}

describe("NutritionService", () => {
  const prisma = {
    $queryRaw: jest.fn(),
    nutritionDiet: { findFirst: jest.fn() },
    nutritionDietOriginalFile: { findFirst: jest.fn() },
  };
  const storage = {
    uploadBuffer: jest.fn(),
    deleteFile: jest.fn(),
    getFileStream: jest.fn(),
  };
  let service: NutritionService;

  const sqlArgs = (call: number) => {
    const [strings, ...values] = prisma.$queryRaw.mock.calls[call] as [
      string[],
      ...unknown[],
    ];
    return { sql: strings.join("?"), values };
  };

  beforeEach(() => {
    jest.resetAllMocks();
    service = new NutritionService(prisma as never, storage as never);
  });

  describe("getState", () => {
    it("calls nutrition_state with the JWT user id and returns the jsonb", async () => {
      const state = { profile: { id: USER }, diets: [] };
      prisma.$queryRaw.mockResolvedValue([{ state }]);

      await expect(service.getState(USER)).resolves.toBe(state);

      const { sql, values } = sqlArgs(0);
      expect(sql).toContain("nutrition_state(");
      expect(values).toEqual([USER]);
    });

    it("maps unexpected database failures to the original error", async () => {
      const failure = new Error("connection lost");
      prisma.$queryRaw.mockRejectedValue(failure);
      await expect(service.getState(USER)).rejects.toBe(failure);
    });
  });

  describe("runCommand", () => {
    it("passes owner id, command and JSON payload to nutrition_command", async () => {
      prisma.$queryRaw.mockResolvedValue([{ result: {} }]);

      await expect(
        service.runCommand(USER, "favorite", { id: DIET, favorite: true }),
      ).resolves.toEqual({ ok: true });

      const { sql, values } = sqlArgs(0);
      expect(sql).toContain("nutrition_command(");
      expect(values).toEqual([
        USER,
        "favorite",
        JSON.stringify({ id: DIET, favorite: true }),
      ]);
    });

    it.each(["cook_recipe", "undo_cook_recipe"])(
      "forwards the %s command to nutrition_command",
      async (command) => {
        prisma.$queryRaw.mockResolvedValue([{ result: {} }]);

        await expect(
          service.runCommand(USER, command, { id: DIET }),
        ).resolves.toEqual({ ok: true });

        expect(sqlArgs(0).values).toEqual([
          USER,
          command,
          JSON.stringify({ id: DIET }),
        ]);
      },
    );

    it.each(["P0001", "23514", "22P02", "23505"])(
      "maps SQLSTATE %s to a generic 400",
      async (code) => {
        prisma.$queryRaw.mockRejectedValue(pgError(code));
        const result = service.runCommand(USER, "save_diet", {});
        await expect(result).rejects.toBeInstanceOf(BadRequestException);
        await expect(result).rejects.toThrow(
          "This change could not be saved. Refresh and verify the selected diet, recipe and permissions.",
        );
      },
    );

    it("maps driver-adapter errors that carry the SQLSTATE in the cause", async () => {
      prisma.$queryRaw.mockRejectedValue(
        Object.assign(new Error("Raw query failed"), {
          code: "P2010",
          meta: { driverAdapterError: { cause: { originalCode: "P0001" } } },
        }),
      );
      await expect(
        service.runCommand(USER, "generate_plan", {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("does not leak the raised database message", async () => {
      prisma.$queryRaw.mockRejectedValue(
        Object.assign(new Error("P0001 secret internal detail"), {
          meta: { code: "P0001" },
        }),
      );
      await expect(service.runCommand(USER, "x", {})).rejects.not.toThrow(
        /secret/,
      );
    });

    it("rethrows non-client database errors", async () => {
      const failure = pgError("57P01");
      prisma.$queryRaw.mockRejectedValue(failure);
      await expect(service.runCommand(USER, "x", {})).rejects.toBe(failure);
    });
  });

  describe("storeOriginal", () => {
    const file = (overrides: Partial<Express.Multer.File> = {}) =>
      ({
        originalname: "diet.pdf",
        buffer: pdfBytes,
        size: pdfBytes.length,
        ...overrides,
      }) as Express.Multer.File;

    beforeEach(() => {
      prisma.nutritionDiet.findFirst.mockResolvedValue({ id: DIET });
      storage.uploadBuffer.mockResolvedValue(`nutrition/${USER}/${FILE_ID}`);
      prisma.$queryRaw.mockResolvedValue([{ result: {} }]);
    });

    it("rejects a missing file", async () => {
      await expect(
        service.storeOriginal(USER, DIET, undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.uploadBuffer).not.toHaveBeenCalled();
    });

    it("rejects invalid file content before touching storage", async () => {
      await expect(
        service.storeOriginal(
          USER,
          DIET,
          file({ originalname: "diet.png", buffer: pdfBytes }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.uploadBuffer).not.toHaveBeenCalled();
    });

    it("returns 404 when the diet is not owned by the user", async () => {
      prisma.nutritionDiet.findFirst.mockResolvedValue(null);
      await expect(
        service.storeOriginal(USER, DIET, file()),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.nutritionDiet.findFirst).toHaveBeenCalledWith({
        where: { id: DIET, ownerId: USER },
        select: { id: true },
      });
      expect(storage.uploadBuffer).not.toHaveBeenCalled();
    });

    it("uploads under nutrition/<userId> and registers the metadata", async () => {
      await expect(service.storeOriginal(USER, DIET, file())).resolves.toEqual({
        ok: true,
        id: FILE_ID,
      });

      expect(storage.uploadBuffer).toHaveBeenCalledWith(pdfBytes, {
        folder: `nutrition/${USER}`,
        mimeType: "application/pdf",
        extension: null,
        size: pdfBytes.length,
      });
      const { sql, values } = sqlArgs(0);
      expect(sql).toContain("nutrition_command(");
      expect(values[0]).toBe(USER);
      expect(values[1]).toBe("original_file");
      expect(JSON.parse(values[2] as string)).toEqual({
        id: FILE_ID,
        dietId: DIET,
        path: `nutrition/${USER}/${FILE_ID}`,
        name: "diet.pdf",
        mime: "application/pdf",
        size: pdfBytes.length,
        hash: createHash("sha256").update(pdfBytes).digest("hex"),
      });
    });

    it("removes the stored object when the metadata cannot be saved", async () => {
      prisma.$queryRaw.mockRejectedValue(pgError("P0001"));
      await expect(
        service.storeOriginal(USER, DIET, file()),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.deleteFile).toHaveBeenCalledWith(
        `nutrition/${USER}/${FILE_ID}`,
      );
    });

    it("still reports the original failure when cleanup fails", async () => {
      prisma.$queryRaw.mockRejectedValue(pgError("P0001"));
      storage.deleteFile.mockRejectedValue(
        new ServiceUnavailableException("down"),
      );
      await expect(
        service.storeOriginal(USER, DIET, file()),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("truncates long file names to 200 characters", async () => {
      const longName = `${"a".repeat(300)}.pdf`;
      await service.storeOriginal(USER, DIET, file({ originalname: longName }));
      const payload = JSON.parse(sqlArgs(0).values[2] as string) as {
        name: string;
      };
      expect(payload.name).toHaveLength(200);
    });
  });

  describe("getOriginal", () => {
    it("returns 404 for files that are not owned by the user", async () => {
      prisma.nutritionDietOriginalFile.findFirst.mockResolvedValue(null);
      await expect(service.getOriginal(USER, FILE_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.nutritionDietOriginalFile.findFirst).toHaveBeenCalledWith({
        where: { id: FILE_ID, ownerId: USER },
        select: { path: true, mime: true, name: true },
      });
      expect(storage.getFileStream).not.toHaveBeenCalled();
    });

    it("streams the stored object with the recorded metadata", async () => {
      const stream = Readable.from([pdfBytes]);
      prisma.nutritionDietOriginalFile.findFirst.mockResolvedValue({
        path: `nutrition/${USER}/${FILE_ID}`,
        mime: "application/pdf",
        name: "diet.pdf",
      });
      storage.getFileStream.mockResolvedValue({
        stream,
        contentType: "application/pdf",
        contentLength: pdfBytes.length,
      });

      await expect(service.getOriginal(USER, FILE_ID)).resolves.toEqual({
        stream,
        mime: "application/pdf",
        name: "diet.pdf",
        contentLength: pdfBytes.length,
      });
      expect(storage.getFileStream).toHaveBeenCalledWith(
        `nutrition/${USER}/${FILE_ID}`,
      );
    });
  });
});
